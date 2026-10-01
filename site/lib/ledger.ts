import "server-only";
import { createPublicClient, defineChain, http, parseAbi, parseAbiItem, type Address, type Hex, type PublicClient } from "viem";
import { addressBook, loadManifest, type Manifest } from "./chain/manifest.ts";
import { readTape, Tape, type TapeRow } from "./chain/tape.ts";
import { getStore } from "./store.ts";

/**
 * The Ledger (ADR 0071): the deployment's lifecycle reconstructed from chain events alone (S-35),
 * read through the ledger RPC (Alchemy on the test network, whose log queries take the whole
 * range), from the deployment's first block, cached for a minute. And, for staff, the register
 * reconciliation: every account the chain or the site knows, what each says, and where they differ.
 */

const CACHE_MS = 60_000;
let cache: { at: number; value: LedgerView } | null = null;
let firstBlock: bigint | null = null;

function client(m: Manifest): PublicClient {
  const rpc = (process.env.LEDGER_RPC_URL ?? process.env.RPC_URL ?? "").trim();
  if (!rpc) throw new Error("LEDGER_RPC_URL and RPC_URL are not set");
  const chain = defineChain({ id: m.chainId, name: `chain ${m.chainId}`, nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [rpc] } } });
  return createPublicClient({ chain, transport: http(rpc) }) as PublicClient;
}

/** The block the deployment began in: the first with code at the Identity Registry, by binary search. */
async function deploymentBlock(c: PublicClient, m: Manifest): Promise<bigint> {
  if (firstBlock !== null) return firstBlock;
  const probe = m.instruments?.registry ?? m.venue.credentialGate;
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
async function withCustodyAccounts(c: PublicClient, m: Manifest, from: bigint): Promise<Manifest> {
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
    [m.network.poolManager, m.network.weth, m.venue.permit2, m.venue.poolManager, m.assets.paymentToken?.address, m.governance?.walletFactory]
      .filter(Boolean)
      .map((a) => String(a).toLowerCase()),
  );
  return tape.watched().filter((a) => !shared.has(a.toLowerCase()));
}

/** The contracts of the notes the site issued, from its own record of them (ADR 0072). */
async function noteContracts(): Promise<Array<{ address: string; key: string; label: string }>> {
  const PARTS: Record<string, string> = { note: "", gate: "gate", determinations: "Determination Agent", recordDates: "record-date engine", payingAgent: "Paying Agent", settlement: "DvP settlement" };
  return (await getStore().listNotes()).flatMap((n) =>
    Object.entries(n.addresses)
      .filter(([part]) => part in PARTS)
      .map(([part, address]) => ({ address, key: `notes.${n.symbol}.${part}`, label: PARTS[part] ? `${n.symbol} ${PARTS[part]}` : n.symbol })),
  );
}

export type LedgerRow = TapeRow & { at: string | null };
export type LedgerView = { rows: LedgerRow[]; fromBlock: number; chainId: number; readAt: string };

export async function readLedger(limit = 150): Promise<LedgerView> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.value;
  const m = loadManifest();
  const c = client(m);
  const from = await deploymentBlock(c, m);
  const tape = new Tape(await withCustodyAccounts(c, m, from), undefined, await noteContracts());
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
  cache = { at: Date.now(), value };
  return value;
}

// ---------------------------------------------------------------------------------------------
// The register reconciliation, for staff
// ---------------------------------------------------------------------------------------------

const GRANTED = parseAbiItem("event Granted(address indexed account, uint16 indexed registrar, uint32 flags, uint16 jurisdiction, uint40 expiresAt, bytes32 credentialRef, bytes32 commitment)");
const VIEWS = parseAbi([
  "function liveFlags(address account) view returns (uint32 flags, uint16 jurisdiction)",
  "function isAllowed(address account) view returns (bool)",
  "function balanceOf(address) view returns (uint256)",
]);

export type RegisterRow = {
  account: Address;
  /** The deployment's name for the account, where it has one (Permit2, a party, a custody account). */
  label: string | null;
  /** Not a disagreement: why the site has no record of it. */
  note: string | null;
  onChain: { pool: boolean; registryFlags: number; deposit: bigint; note: bigint };
  site: { client: string; route: string; status: string; admission: string; revokedAtBank: boolean } | null;
  finding: string | null;
};

export async function reconcile(): Promise<RegisterRow[]> {
  const m = loadManifest();
  const c = client(m);
  const from = await deploymentBlock(c, m);
  const registry = m.instruments?.registry;
  if (!registry) throw new Error("the manifest has no Identity Registry");
  // Every account the chain has granted, and every account the site has onboarded or offboarded.
  const granted = await c.getLogs({ address: registry, event: GRANTED, fromBlock: from, toBlock: "latest" });
  const accounts = new Map<string, Address>();
  for (const l of granted) if (l.args.account) accounts.set(l.args.account.toLowerCase(), l.args.account);
  const known = new Map<string, NonNullable<RegisterRow["site"]>>();
  for (const a of await getStore().listAdmissions(1000)) {
    const d = a.data as Record<string, any>;
    const wallet: string | undefined = d.assessment?.summary?.wallet;
    if (!wallet || !["admitted", "offboarded"].includes(a.status)) continue;
    const key = wallet.toLowerCase();
    // The newest admission of a wallet speaks for it.
    if (!known.has(key)) {
      known.set(key, { client: String(d.record?.legalName ?? d.assessment?.summary?.corporation ?? ""), route: a.route, status: a.status, admission: a.id, revokedAtBank: Boolean(d.bankRevocations?.length) });
    }
    accounts.set(key, wallet as Address);
  }

  const rows: RegisterRow[] = [];
  const book = addressBook(await withCustodyAccounts(c, m, from));
  for (const account of accounts.values()) {
    const [[flags], pool, deposit, noteBalance] = await Promise.all([
      c.readContract({ address: registry, abi: VIEWS, functionName: "liveFlags", args: [account] }),
      c.readContract({ address: m.venue.credentialGate, abi: VIEWS, functionName: "isAllowed", args: [account] }),
      c.readContract({ address: m.assets.deposit!.address as Address, abi: VIEWS, functionName: "balanceOf", args: [account] }),
      m.assets.note ? c.readContract({ address: m.assets.note.address as Address, abi: VIEWS, functionName: "balanceOf", args: [account] }) : Promise.resolve(0n),
    ]);
    const site = known.get(account.toLowerCase()) ?? null;
    const live = Number(flags) !== 0;
    const label = book.get(account.toLowerCase())?.label ?? null;
    const note = !site && live ? (label ? "Granted by the deployment itself" : "Granted on-chain, not through this site") : null;
    const finding =
      !site ? null
      : site.status === "admitted" && !pool && site.revokedAtBank ? "Its credential was revoked at the bank and its pool grant voided on-chain; the site still records it admitted. Offboard it to close the record."
      : site.status === "admitted" && (!pool || !live) ? `The site records it admitted, but on-chain ${!pool ? "the pool does not admit it" : "the registry holds no live grant"}`
      : site.status === "offboarded" && (pool || live) ? `The site records it offboarded, but on-chain ${pool ? "the pool still admits it" : "the registry still grants it"}`
      : null;
    rows.push({ account, label, note, onChain: { pool, registryFlags: Number(flags), deposit, note: noteBalance }, site, finding });
  }
  // Disagreements first, then the site's own accounts, then what the deployment granted itself.
  const rank = (r: RegisterRow) => (r.finding ? 0 : r.site ? 1 : 2);
  return rows.sort((x, y) => rank(x) - rank(y) || x.account.localeCompare(y.account));
}

/** The Ledger's client and the deployment's first block, for other long reads of the chain. */
export async function ledgerFrom(): Promise<{ client: PublicClient; from: bigint }> {
  const m = loadManifest();
  const c = client(m);
  return { client: c, from: await deploymentBlock(c, m) };
}
