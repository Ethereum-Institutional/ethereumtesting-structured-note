import "server-only";
import { createPublicClient, defineChain, http, parseAbi, parseAbiItem, type Address, type Hex, type PublicClient } from "viem";
import { addressBook, loadManifest, type Manifest } from "./chain/manifest.ts";
import { readTape, Tape, type TapeRow } from "./chain/tape.ts";
import { getStore } from "./store.ts";
import { accountNamer } from "./identity/names.ts";
import { holdingsFromIndex } from "./chain/events.ts";
import { notesOnRecord } from "./notes/registry.ts";

/**
 * The Ledger: the deployment's lifecycle reconstructed from chain events alone (S-35),
 * read through the ledger RPC (Alchemy on the test network, whose log queries take the whole
 * range), from the deployment's first block, cached for a minute while no new block lands. And, for staff, the register
 * reconciliation: every account the chain or the site knows, what each says, and where they differ.
 */

const CACHE_MS = 60_000;
let cache: { at: number; head: bigint; value: LedgerView } | null = null;
let firstBlock: bigint | null = null;

export function client(m: Manifest): PublicClient {
  const rpc = (process.env.LEDGER_RPC_URL ?? process.env.RPC_URL ?? "").trim();
  if (!rpc) throw new Error("LEDGER_RPC_URL and RPC_URL are not set");
  const chain = defineChain({ id: m.chainId, name: `chain ${m.chainId}`, nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [rpc] } } });
  return createPublicClient({ chain, transport: http(rpc) }) as PublicClient;
}

/** The block the deployment began in: the first with code at its identity storage, by binary search. */
export async function deploymentBlock(c: PublicClient, m: Manifest): Promise<bigint> {
  if (firstBlock !== null) return firstBlock;
  const probe = (m.identity?.identityStorage ?? m.instruments?.deposit ?? m.assets.deposit?.address) as Address;
  let lo = 0n;
  let hi = await c.getBlockNumber();
  while (lo < hi) {
    const mid = (lo + hi) / 2n;
    const code = await c.getCode({ address: probe, blockNumber: mid }).catch(() => undefined);
    if (code && code !== "0x") hi = mid;
    else lo = mid + 1n;
  }
  // A little before, so the deployment's own first transactions are included.
  firstBlock = lo > 200n ? lo - 200n : 0n;
  return firstBlock;
}

const CREATED = parseAbiItem("event CustodyAccountCreated(address indexed account, string clientRef)");

/**
 * The deployment as the chain knows it: the manifest's custody accounts, plus every account the
 * factory has opened since, from its own events. Accounts opened by the site are then decoded too.
 */
export async function withCustodyAccounts(c: PublicClient, m: Manifest, from: bigint): Promise<Manifest> {
  if (!m.custody?.factory) return m;
  const opened = await c.getLogs({ address: m.custody.factory, event: CREATED, fromBlock: from, toBlock: "latest" });
  const accounts = { ...m.custody.accounts };
  for (const l of opened) if (l.args.account && l.args.clientRef) accounts[l.args.clientRef] = l.args.account;
  return { ...m, custody: { ...m.custody, accounts } };
}

/**
 * The contracts whose events the Ledger reads. On a public network the shared ones (the pool
 * manager, Permit2, WETH, a third-party payment token) carry everyone's traffic, so only the
 * deployment's own are read; every instruction of the lifecycle emits an event on one of those.
 */
function ownContracts(tape: Tape, m: Manifest): Address[] {
  if (m.network?.local !== false) return tape.watched();
  // The Safe factory is shared too; the deployment's own wallets stay, and each records its own setup.
  const shared = new Set(
    [m.network.poolManager, m.network.weth, m.venue?.permit2, m.venue?.poolManager, m.assets.paymentToken?.address, m.governance?.walletFactory]
      .filter(Boolean)
      .map((a) => String(a).toLowerCase()),
  );
  return tape.watched().filter((a) => !shared.has(a.toLowerCase()));
}

/** The contracts of the notes the site issued, from its own record of them. */
export async function noteContracts(): Promise<Array<{ address: string; key: string; label: string }>> {
  const PARTS: Record<string, string> = {
    note: "",
    determinations: "Determination Agent",
    recordDates: "record-date module",
    identityRegistry: "identity registry",
    noteIdentity: "identity",
    payingAgent: "Paying Agent",
    settlement: "locked settlement",
  };
  return (await getStore().listNotes()).flatMap((n) =>
    Object.entries(n.addresses)
      .filter(([part]) => part in PARTS)
      .map(([part, address]) => ({ address, key: `notes.${n.symbol}.${part}`, label: PARTS[part] ? `${n.symbol} ${PARTS[part]}` : n.symbol })),
  );
}

/**
 * The deployment's identities, from the storage's own events: each named for the wallet
 * it was registered for, so the keys and claims institutions add to it appear on the tape.
 */
async function identities(c: PublicClient, m: Manifest, from: bigint): Promise<Array<{ address: string; key: string; label: string }>> {
  if (!m.identity) return [];
  const stored = await c.getLogs({ address: m.identity.identityStorage, event: STORED, fromBlock: from, toBlock: "latest" }).catch(() => []);
  const book = addressBook(m);
  const seen = new Map<string, { address: string; key: string; label: string }>();
  for (const l of stored) {
    const wallet = l.args._investorAddress;
    const identity = l.args._identity;
    if (!wallet || !identity || seen.has(identity.toLowerCase())) continue;
    const who = book.get(wallet.toLowerCase())?.label ?? `${wallet.slice(0, 10)}…`;
    seen.set(identity.toLowerCase(), { address: identity, key: `identities.${wallet}`, label: `Identity of ${who}` });
  }
  return [...seen.values()];
}

export type LedgerRow = TapeRow & { at: string | null };
export type LedgerView = { rows: LedgerRow[]; fromBlock: number; chainId: number; readAt: string };

export async function readLedger(limit = 150): Promise<LedgerView> {
  const m = loadManifest();
  const c = client(m);
  // Kept for a minute, but only while the chain stands still: a new block may carry a new call.
  const head = await c.getBlockNumber();
  if (cache && cache.head === head && Date.now() - cache.at < CACHE_MS) return cache.value;
  const from = await deploymentBlock(c, m);
  const tape = new Tape(await withCustodyAccounts(c, m, from), undefined, [...(await noteContracts()), ...(await identities(c, m, from))]);
  const rows = await readTape(c, tape, limit, from, ownContracts(tape, m));
  const blocks = [...new Set(rows.map((r) => r.block))];
  const times = new Map<number, string>();
  await Promise.all(
    blocks.map(async (b) => {
      const block = await c.getBlock({ blockNumber: BigInt(b) }).catch(() => null);
      if (block) times.set(b, new Date(Number(block.timestamp) * 1000).toISOString());
    }),
  );
  const value = { rows: rows.map((r) => ({ ...r, at: times.get(r.block) ?? null })), fromBlock: Number(from), chainId: m.chainId, readAt: new Date().toISOString() };
  cache = { at: Date.now(), head, value };
  return value;
}

// ---------------------------------------------------------------------------------------------
// The register reconciliation, for staff
// ---------------------------------------------------------------------------------------------

const STORED = parseAbiItem("event IdentityStored(address indexed _investorAddress, address indexed _identity)");
const VIEWS = parseAbi([
  "function isVerified(address) view returns (bool)",
  "function identity(address) view returns (address)",
  "function balanceOf(address) view returns (uint256)",
]);

export type RegisterRow = {
  account: Address;
  /** The deployment's name for the account, where it has one (Permit2, a party, a custody account). */
  label: string | null;
  /** Not a disagreement: why the site has no record of it. */
  note: string | null;
  onChain: { identity: Address | null; depositEligible: boolean; noteEligible: boolean; deposit: bigint; note: bigint; holdings: Array<{ symbol: string; units: bigint }> };
  site: { client: string; route: string; status: string; admission: string } | null;
  finding: string | null;
};

export async function reconcile(): Promise<RegisterRow[]> {
  const m = loadManifest();
  const c = client(m);
  const from = await deploymentBlock(c, m);
  if (!m.identity) throw new Error("the manifest has no identity storage");
  // Every wallet the storage has held an identity for, and every wallet the site has onboarded or offboarded.
  const stored = await c.getLogs({ address: m.identity.identityStorage, event: STORED, fromBlock: from, toBlock: "latest" });
  const accounts = new Map<string, Address>();
  for (const l of stored) if (l.args._investorAddress) accounts.set(l.args._investorAddress.toLowerCase(), l.args._investorAddress);
  const known = new Map<string, NonNullable<RegisterRow["site"]>>();
  const nameOf = await accountNamer();
  for (const a of await getStore().listAdmissions(1000)) {
    const d = a.data as Record<string, any>;
    const wallet: string | undefined = d.wallet;
    if (!wallet || !["onboarded", "offboarded"].includes(a.status)) continue;
    const key = wallet.toLowerCase();
    // The newest onboarding of a wallet speaks for it.
    if (!known.has(key)) known.set(key, { client: nameOf(a), route: a.route, status: a.status, admission: a.id });
    accounts.set(key, wallet as Address);
  }

  const rows: RegisterRow[] = [];
  const book = addressBook(await withCustodyAccounts(c, m, from));
  // Every note's holdings, from the index of the programme's events, and each note's symbol.
  const [held, notes] = await Promise.all([holdingsFromIndex(), notesOnRecord().catch(() => [])]);
  const symbolOf = new Map(notes.map((n) => [n.token.toLowerCase(), n.symbol]));
  const noteRegistry = m.noteSuite?.identityRegistry;
  for (const account of accounts.values()) {
    const [identity, depositEligible, noteEligible, deposit] = await Promise.all([
      c.readContract({ address: m.identity.depositRegistry, abi: VIEWS, functionName: "identity", args: [account] }),
      c.readContract({ address: m.identity.depositRegistry, abi: VIEWS, functionName: "isVerified", args: [account] }),
      noteRegistry ? c.readContract({ address: noteRegistry, abi: VIEWS, functionName: "isVerified", args: [account] }) : Promise.resolve(false),
      c.readContract({ address: m.assets.deposit!.address as Address, abi: VIEWS, functionName: "balanceOf", args: [account] }),
    ]);
    const holdings = [...held.entries()]
      .map(([token, accounts]) => ({ symbol: symbolOf.get(token) ?? token, units: accounts.get(account.toLowerCase()) ?? 0n }))
      .filter((h) => h.units !== 0n);
    const noteBalance = holdings.reduce((t, h) => t + h.units, 0n);
    const site = known.get(account.toLowerCase()) ?? null;
    const registered = !/^0x0{40}$/i.test(identity);
    const label = book.get(account.toLowerCase())?.label ?? null;
    const note = !site && registered ? (label ? "Onboarded by the deployment itself" : "Registered on-chain, not through this site") : null;
    const finding =
      !site ? null
      : site.status === "onboarded" && !registered ? "The site records it onboarded, but the identity storage holds no identity for it"
      : site.status === "onboarded" && !depositEligible ? "The site records it onboarded, but the deposit does not accept it: the bank's claim was revoked or has lapsed. Renew or offboard it."
      : site.status === "offboarded" && registered ? "The site records it offboarded, but the identity storage still holds its identity"
      : noteBalance > 0n && !noteEligible ? "It holds units of a note, but the notes no longer accept it: the onboarding agent's claim was revoked or has lapsed"
      : null;
    rows.push({ account, label, note, onChain: { identity: registered ? identity : null, depositEligible, noteEligible, deposit, note: noteBalance, holdings }, site, finding });
  }
  // Disagreements first, then the site's own accounts, then what the deployment onboarded itself.
  const rank = (r: RegisterRow) => (r.finding ? 0 : r.site ? 1 : 2);
  return rows.sort((x, y) => rank(x) - rank(y) || x.account.localeCompare(y.account));
}

/** The Ledger's client and the deployment's first block, for other long reads of the chain. */
export async function ledgerFrom(): Promise<{ client: PublicClient; from: bigint }> {
  const m = loadManifest();
  const c = client(m);
  return { client: c, from: await deploymentBlock(c, m) };
}
