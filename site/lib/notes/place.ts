import "server-only";
import { createPublicClient, decodeEventLog, defineChain, encodeFunctionData, http, parseAbi, parseAbiItem, type Address, type Hex } from "viem";
import { loadManifest } from "../chain/manifest.ts";
import { signers } from "../chain/signer.ts";
import { getStore, type Admission, type DemoNote, type Registrant } from "../store.ts";
import { hasRole } from "../operators.ts";
import { custodianOf, walletOf } from "../identity/onboarding.ts";
import { custodian } from "../identity/custody.ts";
import { until } from "../chain/until.ts";

/**
 * Selling restrictions, placement, transfers and buy-backs (ADRs 0075, 0081; S-08 to S-14).
 *
 * - **Eligibility for the note** is the onboarding agent's claim on the client's identity (ADR 0089),
 *   which the note's identity registry verifies; the site asks the note, never decides itself.
 * - **Offers.** Every movement of units settles through the note's locked settlement contract: an
 *   offer locks its proposer's side (units frozen in the seller's own wallet, or the price held by
 *   the contract), and its acceptance moves both legs in one transaction, or neither.
 *   - *Placement*: the Issuer offers units from its inventory to a named account.
 *   - *Buy-back*: the Issuer offers to buy units from a named holder; they return to the inventory.
 *   - *Transfer*: between clients, arranged by the bank (both sides named) or posted by a client
 *     as an open offer any approved client may take.
 * - **Each side acts as itself.** A custody account acts through the custodian at once; a client's
 *   own wallet acts in MetaMask. When the bank arranges a trade between two client wallets, the
 *   seller's wallet proposes, and the arrangement waits for it.
 * - **The note's answer first.** Before anything is sent the site asks the note whether its leg
 *   could move, so a counterparty the note would refuse (no note claim, a revoked or lapsed one, a
 *   frozen wallet) is refused with its reason.
 *
 * The chain is the record of offers: the settlement contract's events and state. The site keeps
 * only which account is whose, and arrangements still awaiting a wallet.
 */

const REGISTRY = parseAbi(["function isVerified(address account) view returns (bool)"]);
const NOTE = parseAbi([
  "function approve(address spender, uint256 value) returns (bool)",
  "function balanceOf(address) view returns (uint256)",
  "function isFrozen(address) view returns (bool)",
  "function identityRegistry() view returns (address)",
  "function getFrozenTokens(address) view returns (uint256)",
  "function totalSupply() view returns (uint256)",
  "function burn(address account, uint256 value)",
]);
const DETERMINATIONS = parseAbi(["function transfersOpen() view returns (bool)"]);
const SETTLEMENT = parseAbi([
  "function offer(uint8 side, address counterparty, uint64 units, uint256 price, uint48 deadline) returns (uint256 id)",
  "function accept(uint256 id)",
  "function cancel(uint256 id)",
  "function release(uint256 id)",
  "function noteAccepts(address from, address to, uint256 units) view returns (bool)",
  "function offers(uint256) view returns (address proposer, address counterparty, uint8 side, uint64 units, uint48 deadline, uint8 state, uint256 price)",
  "error InvalidOffer()",
  "error NotOpen(uint256 id)",
  "error Expired(uint256 id)",
  "error NotTheCounterparty(address taker)",
  "error ProposerCannotAccept()",
  "error NotAParty(address caller)",
  "error StillLive(uint256 id)",
  "error UnitsUnavailable(address seller, uint256 units, uint256 available)",
  "error NoAllowance(address owner, uint256 needed)",
  "error NoteLegRefused(address seller, address buyer, uint256 units)",
  "error CashLegRefused(address buyer, address seller, uint256 price)",
]);
const OFFERED = parseAbiItem("event Offered(uint256 indexed id, address indexed proposer, address indexed counterparty, uint8 side, uint256 units, uint256 price, uint256 deadline)");
const SETTLED = parseAbiItem("event Settled(uint256 indexed id, address indexed seller, address indexed buyer, uint256 units, uint256 price)");
const DEPOSIT = parseAbi(["function approve(address spender, uint256 value) returns (bool)", "function balanceOf(address) view returns (uint256)"]);
const ALLOWANCE = parseAbi(["function allowance(address owner, address spender) view returns (uint256)"]);
const ACCOUNT = parseAbi(["function execute((address target, uint256 value, bytes data)[] calls) returns (bytes[])"]);

const SELL = 0;
const BUY = 1;
const STATES = ["none", "offered", "settled", "cancelled", "released"] as const;
const OFFER_HOURS = 24;
const ZERO = "0x0000000000000000000000000000000000000000" as Address;
const now = () => new Date().toISOString();

function context() {
  const m = loadManifest();
  const rpc = process.env.RPC_URL?.trim();
  if (!rpc) throw new Error("RPC_URL is not set");
  const chain = defineChain({ id: m.chainId, name: `chain ${m.chainId}`, nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [rpc] } } });
  // Events over the note's life are read where the Ledger reads them (ADR 0071).
  const logs = createPublicClient({ chain, transport: http(process.env.LEDGER_RPC_URL?.trim() || rpc) });
  return { m, s: signers(chain, rpc), logs };
}
type Signers = ReturnType<typeof signers>;


const same = (a?: string | null, b?: string | null) => Boolean(a && b && a.toLowerCase() === b.toLowerCase());
const euros = (cents: bigint) => `€${(Number(cents) / 100).toLocaleString("en-GB", { minimumFractionDigits: 2 })}`;

/** Whether the note's identity registry verifies the account: whether the note accepts it now. */
export async function eligibleFor(n: DemoNote, account: Address): Promise<boolean> {
  const { s } = context();
  const registry = (n.addresses.identityRegistry as Address | undefined) ?? (await s.publicClient.readContract({ address: n.addresses.note as Address, abi: NOTE, functionName: "identityRegistry" }));
  return s.publicClient.readContract({ address: registry, abi: REGISTRY, functionName: "isVerified", args: [account] });
}

// ---------------------------------------------------------------------------------------------
// Offers, from the chain
// ---------------------------------------------------------------------------------------------

export type Offer = {
  id: string;
  kind: "placement" | "buy-back" | "transfer";
  side: "sell" | "buy";
  proposer: Address;
  counterparty: Address | null;
  units: number;
  priceCents: string;
  deadline: number;
  status: (typeof STATES)[number];
  /** Who the parties are, as the site knows them: an admission's id, or "issuer". */
  proposerAdmission: string | null;
  counterpartyAdmission: string | null;
  seller: Address | null;
  buyer: Address | null;
  offeredTx: string;
  settledTx: string | null;
};

/** A transfer the bank arranged between two client wallets, awaiting the seller's offer (ADR 0081). */
export type Arranged = {
  ref: string;
  seller: string; // admission
  buyer: string | null; // admission, or null for an open offer
  units: number;
  priceCents: string;
  by: string;
  at: string;
  status: "awaiting-seller" | "offered" | "withdrawn";
  offerId?: string;
};

/** Whether the note settles by locked offer (notes issued from ADR 0081 on). */
export const lockedSettlement = (n: DemoNote) => (n.data as Record<string, any>).settlement === "locked";

/** Every account the site onboarded, by address, for naming the parties to an offer. */
async function admissionsByAddress(): Promise<Map<string, Admission>> {
  const map = new Map<string, Admission>();
  // Oldest first, so the newest record of an address wins.
  for (const a of (await getStore().listAdmissions(500)).slice().reverse()) if (walletOf(a)) map.set(walletOf(a).toLowerCase(), a);
  return map;
}

async function startBlock(s: Signers, n: DemoNote): Promise<bigint> {
  const hash = (n.txs.settlement ?? n.txs.note) as Hex | undefined;
  if (!hash) return 0n;
  return (await s.publicClient.getTransactionReceipt({ hash }).catch(() => null))?.blockNumber ?? 0n;
}

/** Every offer on the note's settlement contract, newest first: at the latest block, or at block `at` (ADR 0094). */
export async function offersOf(n: DemoNote, at?: bigint): Promise<Offer[]> {
  if (!lockedSettlement(n)) return [];
  const { s, logs } = context();
  const settlement = n.addresses.settlement as Address;
  const from = await startBlock(s, n);
  const to = at ?? ("latest" as const);
  const [offered, settled, byAddress] = await Promise.all([
    logs.getLogs({ address: settlement, event: OFFERED, fromBlock: from, toBlock: to }),
    logs.getLogs({ address: settlement, event: SETTLED, fromBlock: from, toBlock: to }),
    admissionsByAddress(),
  ]);
  const issuer = s.address("issuer");
  const pin = at === undefined ? {} : { blockNumber: at };
  const states = await Promise.all(offered.map((l) => s.publicClient.readContract({ address: settlement, abi: SETTLEMENT, functionName: "offers", args: [l.args.id!], ...pin })));
  const nameOf = (a: Address | null) => (!a ? null : same(a, issuer) ? "issuer" : byAddress.get(a.toLowerCase())?.id ?? null);
  return offered
    .map((l, i): Offer => {
      const a = l.args;
      const side = Number(a.side) === SELL ? "sell" : "buy";
      const counterparty = a.counterparty && !same(a.counterparty, ZERO) ? a.counterparty : null;
      const done = settled.find((x) => x.args.id === a.id);
      return {
        id: String(a.id),
        kind: same(a.proposer, issuer) ? (side === "sell" ? "placement" : "buy-back") : "transfer",
        side,
        proposer: a.proposer!,
        counterparty,
        units: Number(a.units),
        priceCents: String(a.price),
        deadline: Number(a.deadline),
        status: STATES[Number(states[i][5])] ?? "none",
        proposerAdmission: nameOf(a.proposer!),
        counterpartyAdmission: nameOf(counterparty),
        seller: done?.args.seller ?? (side === "sell" ? a.proposer! : counterparty),
        buyer: done?.args.buyer ?? (side === "buy" ? a.proposer! : counterparty),
        offeredTx: l.transactionHash,
        settledTx: done?.transactionHash ?? null,
      };
    })
    .reverse();
}

async function offerById(n: DemoNote, id: string): Promise<Offer> {
  const o = (await offersOf(n)).find((x) => x.id === id);
  if (!o) throw new Error(`No offer ${id} on ${n.symbol}.`);
  return o;
}

/** The offer a transaction made, read from its receipt, so the site knows its number at once. */
async function offerIdFrom(s: Signers, hash: Hex): Promise<string> {
  const receipt = await s.publicClient.getTransactionReceipt({ hash });
  for (const l of receipt.logs) {
    try {
      const e = decodeEventLog({ abi: [OFFERED], data: l.data, topics: l.topics });
      if (e.eventName === "Offered") return String((e.args as { id: bigint }).id);
    } catch {
      // another contract's event
    }
  }
  throw new Error("The offer was sent, but its number was not found in the receipt.");
}

async function noteFor(noteId: string): Promise<DemoNote> {
  const n = await getStore().noteById(noteId);
  if (!n || n.status !== "issued") throw new Error("That note is not issued.");
  if (!lockedSettlement(n)) throw new Error(`${n.symbol} was issued before locked settlement (ADR 0081); issue a new note to trade.`);
  return n;
}

async function admitted(id: string): Promise<Admission> {
  const a = await getStore().admissionById(id);
  if (!a || a.status !== "onboarded") throw new Error("Choose an onboarded account.");
  return a;
}

/**
 * Refuses, with its reason, a movement of units the note would not make now. For an offer to sell
 * the seller's units are frozen by that very offer, and released only as it settles: the note is
 * then asked about the two parties alone (a transfer of nothing), not the frozen balance.
 */
async function noteWouldMove(s: Signers, n: DemoNote, seller: Address, buyer: Address, units: number, lockedByTheOffer = false): Promise<void> {
  const value = lockedByTheOffer ? 0n : BigInt(units);
  const [open, could] = await Promise.all([
    s.publicClient.readContract({ address: n.addresses.determinations as Address, abi: DETERMINATIONS, functionName: "transfersOpen" }),
    until(() => s.publicClient.readContract({ address: n.addresses.settlement as Address, abi: SETTLEMENT, functionName: "noteAccepts", args: [seller, buyer, value] }), Boolean),
  ]);
  if (!open) throw new Error("Transfers are stopped from a record time until its determination (ADR 0010); trade once it is determined.");
  if (!could) {
    const note = n.addresses.note as Address;
    if (!(await eligibleFor(n, buyer))) {
      throw new Error("The buyer is not eligible for the note: its identity carries no valid claim from the onboarding agent, or it was revoked or has lapsed (S-09, S-12). The client asks for access to the note, and the onboarding agent approves it.");
    }
    const [sellerFrozen, buyerFrozen] = await Promise.all([
      s.publicClient.readContract({ address: note, abi: NOTE, functionName: "isFrozen", args: [seller] }),
      s.publicClient.readContract({ address: note, abi: NOTE, functionName: "isFrozen", args: [buyer] }),
    ]);
    if (sellerFrozen || buyerFrozen) throw new Error(`The note refuses this transfer: the ${sellerFrozen ? "seller's" : "buyer's"} wallet is frozen.`);
    throw new Error("The note refuses this transfer: the note may be paused, or the units locked in another offer.");
  }
}

/** Units an account holds that are not locked in an offer. */
async function unlockedUnits(s: Signers, n: DemoNote, account: Address, atLeast = 0): Promise<bigint> {
  const note = n.addresses.note as Address;
  const [held, frozen] = await Promise.all([
    // Just after a mint or a settlement a lagging RPC may answer from the block before it.
    until(() => s.publicClient.readContract({ address: note, abi: NOTE, functionName: "balanceOf", args: [account] }), (v) => v >= BigInt(atLeast), atLeast ? 7 : 0),
    s.publicClient.readContract({ address: note, abi: NOTE, functionName: "getFrozenTokens", args: [account] }),
  ]);
  return held - frozen;
}

/** An offer's deadline, from the chain's clock, which is the one the contract compares against. */
async function deadlineOf(s: Signers): Promise<number> {
  return Number((await s.publicClient.getBlock()).timestamp) + OFFER_HOURS * 3600;
}

type Call = { target: Address; data: Hex };
/** Calls a custody account makes through its custodian, in one transaction. */
function asCustody(s: Signers, a: Admission, calls: Call[]): Promise<Hex> {
  const which = custodianOf(a);
  if (!which) throw new Error("That account is not held by a custodian.");
  return s.send(custodian(which).capacity, { address: walletOf(a), abi: ACCOUNT, functionName: "execute", args: [calls.map((c) => ({ target: c.target, value: 0n, data: c.data }))] });
}
const isCustody = (a: Admission | null | undefined) => Boolean(a && custodianOf(a));
const approveUnits = (n: DemoNote, units: number): Call => ({ target: n.addresses.note as Address, data: encodeFunctionData({ abi: NOTE, functionName: "approve", args: [n.addresses.settlement as Address, BigInt(units)] }) });
const approveCash = (deposit: Address, n: DemoNote, cents: bigint): Call => ({ target: deposit, data: encodeFunctionData({ abi: DEPOSIT, functionName: "approve", args: [n.addresses.settlement as Address, cents] }) });
const offerCall = (n: DemoNote, side: number, counterparty: Address | null, units: number, cents: bigint, until: number): Call => ({
  target: n.addresses.settlement as Address,
  data: encodeFunctionData({ abi: SETTLEMENT, functionName: "offer", args: [side, counterparty ?? ZERO, BigInt(units), cents, until] }),
});
const acceptCall = (n: DemoNote, id: string): Call => ({ target: n.addresses.settlement as Address, data: encodeFunctionData({ abi: SETTLEMENT, functionName: "accept", args: [BigInt(id)] }) });
const cancelCall = (n: DemoNote, id: string): Call => ({ target: n.addresses.settlement as Address, data: encodeFunctionData({ abi: SETTLEMENT, functionName: "cancel", args: [BigInt(id)] }) });

async function waitForState(s: Signers, n: DemoNote, id: string, state: (typeof STATES)[number]) {
  await until(() => s.publicClient.readContract({ address: n.addresses.settlement as Address, abi: SETTLEMENT, functionName: "offers", args: [BigInt(id)] }), (o) => STATES[Number(o[5])] === state);
}

/** Waits until an allowance just given is visible: the next call is estimated against the chain's view. */
async function allowed(s: Signers, token: Address, owner: Address, n: DemoNote, amount: bigint) {
  await until(() => s.publicClient.readContract({ address: token, abi: ALLOWANCE, functionName: "allowance", args: [owner, n.addresses.settlement as Address] }), (v) => v >= amount);
}

const audit = (actor: string, n: DemoNote, action: string) => getStore().audit({ at: now(), actor, action, subject: n.id });

// ---------------------------------------------------------------------------------------------
// The Issuer's offers: placement and buy-back; and cancelling from the inventory
// ---------------------------------------------------------------------------------------------

/**
 * Staff place units with an approved account (S-08): the Issuer offers units from its inventory,
 * locked until accepted. A custody account accepts through the custodian in the same action.
 */
export async function placeUnits(staff: Registrant, noteId: string, admissionId: string, units: number, pricePerUnitCents: bigint): Promise<Offer> {
  if (!hasRole(staff.email, "agent")) throw new Error("Not permitted.");
  const n = await noteFor(noteId);
  const a = await admitted(admissionId);
  if (!Number.isInteger(units) || units < 1) throw new Error("Place at least one unit.");
  if (pricePerUnitCents <= 0n) throw new Error("The price must be more than zero.");
  const { m, s } = context();
  const buyer = walletOf(a);
  const issuer = s.address("issuer");
  const price = pricePerUnitCents * BigInt(units);
  const inventory = await unlockedUnits(s, n, issuer, units);
  if (inventory < BigInt(units)) throw new Error(`The Issuer's inventory holds ${inventory} units not already offered, not ${units}.`);
  await noteWouldMove(s, n, issuer, buyer, units);
  // The cash leg, before anything is sent: an offer the buyer cannot pay for would lock the units until it lapses.
  // Read until it suffices or a few blocks pass: an RPC a block behind may not yet show a credit just made.
  const cash = await until(
    () => s.publicClient.readContract({ address: m.assets.deposit!.address as Address, abi: DEPOSIT, functionName: "balanceOf", args: [buyer] }),
    (v) => v >= price,
  );
  if (cash < price) {
    throw new Error(`The buyer holds ${euros(cash)} of the deposit; ${units} units cost ${euros(price)}. The bank credits its deposit first: Bank → Onboarding, Credit deposit… on its row.`);
  }

  await s.send("issuer", { address: n.addresses.note as Address, abi: NOTE, functionName: "approve", args: [n.addresses.settlement as Address, BigInt(units)] });
  await allowed(s, n.addresses.note as Address, issuer, n, BigInt(units));
  const offered = await s.send("issuer", { address: n.addresses.settlement as Address, abi: SETTLEMENT, functionName: "offer", args: [SELL, buyer, BigInt(units), price, await deadlineOf(s)] });
  const id = await offerIdFrom(s, offered);
  await waitForState(s, n, id, "offered");
  await audit(staff.email, n, `offered ${units} units of ${n.symbol} to ${buyer} for ${euros(price)}, offer ${id}`);

  if (isCustody(a)) {
    // On the client's instruction: the custodian accepts for the account, both calls in one transaction.
    await asCustody(s, a, [approveCash(m.assets.deposit!.address as Address, n, price), acceptCall(n, id)]);
    await waitForState(s, n, id, "settled");
    await audit(staff.email, n, `the custodian accepted offer ${id} for ${buyer}: ${units} units of ${n.symbol} against ${euros(price)}`);
  }
  return offerById(n, id);
}

/**
 * Staff offer to buy units back from a holder (S-13): the Issuer's price is held by the settlement
 * contract until the holder accepts; the units return to the inventory, pending.
 */
export async function offerBuyback(staff: Registrant, noteId: string, admissionId: string, units: number, pricePerUnitCents: bigint): Promise<Offer> {
  if (!hasRole(staff.email, "agent")) throw new Error("Not permitted.");
  const n = await noteFor(noteId);
  const a = await admitted(admissionId);
  if (!Number.isInteger(units) || units < 1) throw new Error("Buy back at least one unit.");
  if (pricePerUnitCents <= 0n) throw new Error("The price must be more than zero.");
  const { m, s } = context();
  const deposit = m.assets.deposit!.address as Address;
  const holder = walletOf(a);
  const issuer = s.address("issuer");
  const price = pricePerUnitCents * BigInt(units);
  const available = await unlockedUnits(s, n, holder);
  if (available < BigInt(units)) throw new Error(`The holder has ${available} units not already offered, not ${units}.`);
  await noteWouldMove(s, n, holder, issuer, units);
  const cash = await s.publicClient.readContract({ address: deposit, abi: DEPOSIT, functionName: "balanceOf", args: [issuer] });
  if (cash < price) throw new Error(`The Issuer holds ${euros(cash)} of the deposit; the buy-back costs ${euros(price)}.`);

  await s.send("issuer", { address: deposit, abi: DEPOSIT, functionName: "approve", args: [n.addresses.settlement as Address, price] });
  await allowed(s, deposit, issuer, n, price);
  const offered = await s.send("issuer", { address: n.addresses.settlement as Address, abi: SETTLEMENT, functionName: "offer", args: [BUY, holder, BigInt(units), price, await deadlineOf(s)] });
  const id = await offerIdFrom(s, offered);
  await waitForState(s, n, id, "offered");
  await audit(staff.email, n, `offered to buy back ${units} units of ${n.symbol} from ${holder} for ${euros(price)}, offer ${id}`);

  if (isCustody(a)) {
    await asCustody(s, a, [approveUnits(n, units), acceptCall(n, id)]);
    await waitForState(s, n, id, "settled");
    await audit(staff.email, n, `the custodian accepted buy-back ${id} for ${holder}: ${units} units of ${n.symbol} returned to the inventory`);
  }
  return offerById(n, id);
}

/**
 * Staff cancel units from the Issuer's inventory, reducing the note's total (S-14). Only units in
 * the inventory and not offered can be cancelled; asking for more is refused with what there is.
 */
export async function cancelFromInventory(staff: Registrant, noteId: string, units: number): Promise<Hex> {
  if (!hasRole(staff.email, "agent")) throw new Error("Not permitted.");
  const n = await noteFor(noteId);
  if (!Number.isInteger(units) || units < 1) throw new Error("Cancel at least one unit.");
  const { s } = context();
  const issuer = s.address("issuer");
  const pending = await unlockedUnits(s, n, issuer);
  if (BigInt(units) > pending) throw new Error(`The Issuer's inventory holds ${pending} units not offered; ${units} cannot be cancelled (S-14).`);
  const tx = await s.send("agent", { address: n.addresses.note as Address, abi: NOTE, functionName: "burn", args: [issuer, BigInt(units)] });
  await audit(staff.email, n, `cancelled ${units} units of ${n.symbol} from the Issuer's inventory`);
  return tx;
}

// ---------------------------------------------------------------------------------------------
// Transfers between clients
// ---------------------------------------------------------------------------------------------

async function recordArranged(noteId: string, change: (list: Arranged[]) => Arranged[]) {
  const store = getStore();
  for (let tries = 0; tries < 5; tries++) {
    const latest = (await store.noteById(noteId))!;
    const list = change(((latest.data.arranged ?? []) as Arranged[]).slice());
    if (await store.updateNote({ ...latest, data: { ...latest.data, arranged: list } }, latest.step)) return;
  }
  throw new Error("The note changed while recording; look again.");
}

/**
 * The bank arranges a transfer (ADR 0081): the seller, the buyer (or none, for an open offer), the
 * units and the price. Whichever side is a custody account acts at once through the custodian; a
 * client's own wallet acts in MetaMask. Between two wallets the arrangement waits for the seller.
 */
export async function arrangeTrade(
  staff: Registrant,
  noteId: string,
  input: { seller: string; buyer: string | null; units: number; pricePerUnitCents: bigint },
): Promise<{ offer?: Offer; arranged?: Arranged }> {
  if (!hasRole(staff.email, "agent")) throw new Error("Not permitted.");
  const n = await noteFor(noteId);
  const seller = await admitted(input.seller);
  const buyer = input.buyer ? await admitted(input.buyer) : null;
  if (buyer && buyer.id === seller.id) throw new Error("Choose two different accounts.");
  if (!Number.isInteger(input.units) || input.units < 1) throw new Error("Transfer at least one unit.");
  if (input.pricePerUnitCents <= 0n) throw new Error("The price must be more than zero.");
  const { m, s } = context();
  const deposit = m.assets.deposit!.address as Address;
  const from = walletOf(seller);
  const to = buyer ? walletOf(buyer) : null;
  const price = input.pricePerUnitCents * BigInt(input.units);
  const available = await unlockedUnits(s, n, from);
  if (available < BigInt(input.units)) throw new Error(`The seller has ${available} units not already offered, not ${input.units}.`);
  if (to) await noteWouldMove(s, n, from, to, input.units);

  if (isCustody(seller)) {
    // The custodian offers for the seller, its units locked; a custody buyer accepts at once.
    const id = await offerIdFrom(s, await asCustody(s, seller, [approveUnits(n, input.units), offerCall(n, SELL, to, input.units, price, await deadlineOf(s))]));
    await waitForState(s, n, id, "offered");
    await audit(staff.email, n, `arranged a sale of ${input.units} units of ${n.symbol} from ${from} ${to ? `to ${to}` : "as an open offer"} for ${euros(price)}, offer ${id}`);
    if (isCustody(buyer)) {
      await asCustody(s, buyer!, [approveCash(deposit, n, price), acceptCall(n, id)]);
      await waitForState(s, n, id, "settled");
    }
    return { offer: await offerById(n, id) };
  }
  if (isCustody(buyer)) {
    // The custodian offers to buy for the buyer, its price held; the seller's wallet accepts.
    const id = await offerIdFrom(s, await asCustody(s, buyer!, [approveCash(deposit, n, price), offerCall(n, BUY, from, input.units, price, await deadlineOf(s))]));
    await waitForState(s, n, id, "offered");
    await audit(staff.email, n, `arranged a purchase of ${input.units} units of ${n.symbol} by ${to} from ${from} for ${euros(price)}, offer ${id}`);
    return { offer: await offerById(n, id) };
  }
  // A wallet sells: it proposes in MetaMask, and the arrangement waits for it.
  const arranged: Arranged = {
    ref: `ARR-${Date.now().toString(36).toUpperCase()}`,
    seller: seller.id,
    buyer: buyer?.id ?? null,
    units: input.units,
    priceCents: String(price),
    by: staff.email,
    at: now(),
    status: "awaiting-seller",
  };
  await recordArranged(n.id, (list) => [...list, arranged]);
  await audit(staff.email, n, `arranged a sale of ${input.units} units of ${n.symbol} from ${from} ${to ? `to ${to}` : "as an open offer"} for ${euros(price)}; awaiting the seller's offer (${arranged.ref})`);
  return { arranged };
}

/** Staff withdraw an arrangement still awaiting the seller's offer. */
export async function withdrawArranged(staff: Registrant, noteId: string, ref: string): Promise<void> {
  if (!hasRole(staff.email, "agent")) throw new Error("Not permitted.");
  await recordArranged(noteId, (list) => list.map((x) => (x.ref === ref && x.status === "awaiting-seller" ? { ...x, status: "withdrawn" as const } : x)));
}

/** Staff take an open offer for a custody account, through the custodian. */
export async function takeForCustody(staff: Registrant, noteId: string, offerId: string, admissionId: string): Promise<Offer> {
  if (!hasRole(staff.email, "agent")) throw new Error("Not permitted.");
  const n = await noteFor(noteId);
  const a = await admitted(admissionId);
  if (!isCustody(a)) throw new Error("Only a custody account is taken for through its custodian.");
  const o = await offerById(n, offerId);
  if (o.status !== "offered") throw new Error("That offer is not open.");
  if (o.counterparty && !same(o.counterparty, walletOf(a))) throw new Error("That offer is for another account.");
  const { m, s } = context();
  const account = walletOf(a);
  if (o.side === "sell") {
    await noteWouldMove(s, n, o.proposer, account, o.units, true);
    await asCustody(s, a, [approveCash(m.assets.deposit!.address as Address, n, BigInt(o.priceCents)), acceptCall(n, o.id)]);
  } else {
    await noteWouldMove(s, n, account, o.proposer, o.units);
    await asCustody(s, a, [approveUnits(n, o.units), acceptCall(n, o.id)]);
  }
  await waitForState(s, n, o.id, "settled");
  await audit(staff.email, n, `the custodian took offer ${o.id} of ${n.symbol} for ${account}`);
  return offerById(n, o.id);
}

/**
 * Staff withdraw or decline an offer whose side the site acts for: the Issuer's, or a custody
 * account's (as proposer, or as the named counterparty declining it). Its lock ends.
 */
export async function cancelOffer(staff: Registrant, noteId: string, offerId: string): Promise<Hex> {
  if (!hasRole(staff.email, "agent")) throw new Error("Not permitted.");
  const n = await noteFor(noteId);
  const o = await offerById(n, offerId);
  if (o.status !== "offered") throw new Error("That offer is not open.");
  const { s } = context();
  const store = getStore();
  const custody = async (admission: string | null) => {
    const a = admission && admission !== "issuer" ? await store.admissionById(admission) : null;
    return isCustody(a) ? a : null;
  };
  let tx: Hex;
  if (o.proposerAdmission === "issuer" || o.counterpartyAdmission === "issuer") {
    tx = await s.send("issuer", { address: n.addresses.settlement as Address, abi: SETTLEMENT, functionName: "cancel", args: [BigInt(o.id)] });
  } else {
    const a = (await custody(o.proposerAdmission)) ?? (o.counterparty ? await custody(o.counterpartyAdmission) : null);
    if (!a) throw new Error("Only the client's own wallet can withdraw that offer.");
    tx = await asCustody(s, a, [cancelCall(n, o.id)]);
  }
  await waitForState(s, n, o.id, "cancelled");
  await audit(staff.email, n, `withdrew offer ${o.id} of ${n.symbol}`);
  return tx;
}

/**
 * Releases the note's open offers that may be released: past their deadline, or every one once the
 * note is paused, which opening a redemption does (frozen units could not otherwise be burned).
 * Anyone may; the Agent's key sends. Returns how many were released.
 */
export async function releaseOpenOffers(noteId: string, all = false): Promise<number> {
  const n = await getStore().noteById(noteId);
  if (!n || !lockedSettlement(n)) return 0;
  const { s } = context();
  const block = await s.publicClient.getBlock();
  const due = (await offersOf(n)).filter((o) => o.status === "offered" && (all || o.deadline < Number(block.timestamp)));
  for (const o of due) {
    await s.send("agent", { address: n.addresses.settlement as Address, abi: SETTLEMENT, functionName: "release", args: [BigInt(o.id)] });
    await waitForState(s, n, o.id, "released");
  }
  return due.length;
}

// ---------------------------------------------------------------------------------------------
// What a client's own wallet sends, in MetaMask
// ---------------------------------------------------------------------------------------------

export type Tx = { to: Address; data: Hex; label: string };

async function clientWallet(client: Registrant, address: string): Promise<{ admission: Admission; wallet: Address }> {
  const mine = await getStore().admissionsFor(client.id);
  const own = mine.filter((x) => x.status === "onboarded" && !custodianOf(x));
  const a = own.find((x) => same(walletOf(x), address));
  if (!a) throw new Error(own[0] ? `The wallet connected is ${address}; switch MetaMask to your onboarded wallet, ${walletOf(own[0])}.` : "Only an onboarded wallet can trade.");
  return { admission: a, wallet: walletOf(a) };
}

/** The transactions a client's wallet sends to accept an offer named to it, or take an open one. */
export async function acceptanceFor(client: Registrant, noteId: string, offerId: string, address: string): Promise<Tx[]> {
  const n = await noteFor(noteId);
  const o = await offerById(n, offerId);
  if (o.status !== "offered") throw new Error("That offer is not open.");
  const mine = await getStore().admissionsFor(client.id);
  if (o.counterparty && !mine.some((x) => same(walletOf(x), o.counterparty))) throw new Error("That offer is not yours.");
  const { wallet } = await clientWallet(client, address);
  if (same(o.proposer, wallet)) throw new Error("That is your own offer.");
  const { m, s } = context();
  const deposit = m.assets.deposit!.address as Address;
  if (o.side === "sell") {
    await noteWouldMove(s, n, o.proposer, wallet, o.units, true);
    const held = await s.publicClient.readContract({ address: deposit, abi: DEPOSIT, functionName: "balanceOf", args: [wallet] });
    if (held < BigInt(o.priceCents)) throw new Error(`The wallet holds ${euros(held)} of the deposit; the price is ${euros(BigInt(o.priceCents))}. Ask your bank to credit the deposit.`);
    const c = approveCash(deposit, n, BigInt(o.priceCents));
    return [
      { to: c.target, data: c.data, label: "Allow the settlement contract the price" },
      { to: n.addresses.settlement as Address, data: acceptCall(n, o.id).data, label: `Buy ${o.units} units of ${n.symbol}` },
    ];
  }
  const available = await unlockedUnits(s, n, wallet);
  if (available < BigInt(o.units)) throw new Error(`The wallet has ${available} units not already offered; the offer asks for ${o.units}.`);
  await noteWouldMove(s, n, wallet, o.proposer, o.units);
  const c = approveUnits(n, o.units);
  return [
    { to: c.target, data: c.data, label: "Allow the settlement contract the units" },
    { to: n.addresses.settlement as Address, data: acceptCall(n, o.id).data, label: `Sell ${o.units} units of ${n.symbol}` },
  ];
}

/**
 * The transactions a client's wallet sends to make an offer: one its bank arranged, or an open
 * offer of its own to sell or to buy. The offer locks its side until it settles or ends.
 */
export async function offerTxsFor(
  client: Registrant,
  noteId: string,
  input: { arranged?: string; side?: "sell" | "buy"; units?: number; pricePerUnitCents?: bigint },
  address: string,
): Promise<Tx[]> {
  const n = await noteFor(noteId);
  const { admission, wallet } = await clientWallet(client, address);
  const { m, s } = context();
  let side: "sell" | "buy" = input.side === "buy" ? "buy" : "sell";
  let counterparty: Address | null = null;
  let units = Number(input.units);
  let price = (input.pricePerUnitCents ?? 0n) * BigInt(Number.isInteger(units) ? units : 0);
  if (input.arranged) {
    const arr = ((n.data.arranged ?? []) as Arranged[]).find((x) => x.ref === input.arranged && x.status === "awaiting-seller");
    if (!arr || arr.seller !== admission.id) throw new Error("That arrangement is not open for this wallet.");
    side = "sell";
    units = arr.units;
    price = BigInt(arr.priceCents);
    if (arr.buyer) counterparty = walletOf(await admitted(arr.buyer));
  } else {
    if (!Number.isInteger(units) || units < 1) throw new Error("Offer at least one unit.");
    if (price <= 0n) throw new Error("The price must be more than zero.");
  }
  const open = await s.publicClient.readContract({ address: n.addresses.determinations as Address, abi: DETERMINATIONS, functionName: "transfersOpen" });
  if (!open) throw new Error("Transfers are stopped from a record time until its determination; offer once it is determined.");
  if (side === "sell") {
    const available = await unlockedUnits(s, n, wallet);
    if (available < BigInt(units)) throw new Error(`The wallet has ${available} units not already offered, not ${units}.`);
    if (counterparty) await noteWouldMove(s, n, wallet, counterparty, units);
    const a = approveUnits(n, units);
    const o = offerCall(n, SELL, counterparty, units, price, await deadlineOf(s));
    return [
      { to: a.target, data: a.data, label: "Allow the settlement contract the units" },
      { to: o.target, data: o.data, label: `Offer ${units} units of ${n.symbol} for ${euros(price)}, locked until taken or withdrawn` },
    ];
  }
  const deposit = m.assets.deposit!.address as Address;
  const held = await s.publicClient.readContract({ address: deposit, abi: DEPOSIT, functionName: "balanceOf", args: [wallet] });
  if (held < price) throw new Error(`The wallet holds ${euros(held)} of the deposit; the offer needs ${euros(price)}. Ask your bank to credit the deposit.`);
  const a = approveCash(deposit, n, price);
  const o = offerCall(n, BUY, null, units, price, await deadlineOf(s));
  return [
    { to: a.target, data: a.data, label: "Allow the settlement contract the price" },
    { to: o.target, data: o.data, label: `Offer to buy ${units} units of ${n.symbol} for ${euros(price)}, held until taken or withdrawn` },
  ];
}

/** The transaction a client's wallet sends to withdraw its own offer, or decline one named to it. */
export async function cancelTxFor(client: Registrant, noteId: string, offerId: string, address: string): Promise<Tx[]> {
  const n = await noteFor(noteId);
  const o = await offerById(n, offerId);
  if (o.status !== "offered") throw new Error("That offer is not open.");
  const { wallet } = await clientWallet(client, address);
  if (!same(o.proposer, wallet) && !same(o.counterparty, wallet)) throw new Error("That offer is not yours.");
  return [{ to: n.addresses.settlement as Address, data: cancelCall(n, o.id).data, label: same(o.proposer, wallet) ? "Withdraw the offer" : "Decline the offer" }];
}

/** After a wallet's last transaction: an arrangement it answered is marked offered, and it is audited. */
export async function walletActed(client: Registrant, noteId: string, tx: string, arranged?: string): Promise<void> {
  const n = await getStore().noteById(noteId);
  if (!n) return;
  const { s } = context();
  await s.publicClient.waitForTransactionReceipt({ hash: tx as Hex, timeout: 30_000 }).catch(() => null);
  const id = await offerIdFrom(s, tx as Hex).catch(() => null);
  if (id) {
    // Shown to its counterparty only once the chain's view includes it.
    await until(() => offersOf(n), (all) => all.some((o) => o.id === id && o.status !== "none"));
    if (arranged) await recordArranged(noteId, (list) => list.map((x) => (x.ref === arranged ? { ...x, status: "offered" as const, offerId: id } : x)));
  }
  await audit(client.email, n, `traded ${n.symbol} from its own wallet: ${tx}`);
}

type OnNote<T> = Array<{ note: DemoNote } & T>;

/** What the client's Notes page shows of offers, across every note it may trade. */
export async function offersFor(client: Registrant): Promise<{
  toMe: OnNote<{ offer: Offer }>;
  open: OnNote<{ offer: Offer }>;
  mine: OnNote<{ offer: Offer }>;
  arranged: OnNote<{ arranged: Arranged }>;
  done: OnNote<{ offer: Offer }>;
}> {
  const store = getStore();
  const own = (await store.admissionsFor(client.id)).filter((x) => x.status === "onboarded" || x.status === "offboarded");
  const ids = new Set(own.map((x) => x.id));
  const wallets = own.map(walletOf).filter(Boolean);
  const isMine = (a: string | null) => wallets.some((w) => same(w, a));
  const out = { toMe: [] as OnNote<{ offer: Offer }>, open: [] as OnNote<{ offer: Offer }>, mine: [] as OnNote<{ offer: Offer }>, arranged: [] as OnNote<{ arranged: Arranged }>, done: [] as OnNote<{ offer: Offer }> };
  for (const note of (await store.listNotes()).filter((n) => (n.status === "issued" || n.status === "closed") && lockedSettlement(n))) {
    for (const offer of await offersOf(note).catch(() => [])) {
      if (offer.status !== "offered") {
        if ([offer.proposer, offer.counterparty, offer.seller, offer.buyer].some(isMine)) out.done.push({ note, offer });
      } else if (note.status !== "issued") continue;
      else if (isMine(offer.proposer)) out.mine.push({ note, offer });
      else if (isMine(offer.counterparty)) out.toMe.push({ note, offer });
      else if (!offer.counterparty) out.open.push({ note, offer });
    }
    if (note.status !== "issued") continue;
    for (const arranged of (note.data.arranged ?? []) as Arranged[]) {
      if (arranged.status === "awaiting-seller" && ids.has(arranged.seller)) out.arranged.push({ note, arranged });
    }
  }
  return out;
}

/** An offer's state just after a wallet acted on it, waiting briefly for the chain to show it. */
export async function refreshPlacement(noteId: string, offerId: string, tx?: string): Promise<Offer | null> {
  const n = await getStore().noteById(noteId);
  if (!n || !lockedSettlement(n)) return null;
  if (tx) {
    const { s } = context();
    await until(() => s.publicClient.readContract({ address: n.addresses.settlement as Address, abi: SETTLEMENT, functionName: "offers", args: [BigInt(offerId)] }), (o) => Number(o[5]) !== 1, 5);
  }
  return (await offersOf(n)).find((o) => o.id === offerId) ?? null;
}

// ---------------------------------------------------------------------------------------------
// Holdings
// ---------------------------------------------------------------------------------------------

/** The units of each issued note an account holds, and how many of them are locked in offers. */
export async function holdingsOf(account: Address): Promise<Array<{ note: DemoNote; units: bigint; locked: bigint }>> {
  const { s } = context();
  const notes = (await getStore().listNotes()).filter((n) => n.status === "issued" && n.addresses.note);
  const held = await Promise.all(
    notes.map(async (n) => {
      const note = n.addresses.note as Address;
      const [units, locked] = await Promise.all([
        s.publicClient.readContract({ address: note, abi: NOTE, functionName: "balanceOf", args: [account] }).catch(() => 0n),
        s.publicClient.readContract({ address: note, abi: NOTE, functionName: "getFrozenTokens", args: [account] }).catch(() => 0n),
      ]);
      return { units, locked };
    }),
  );
  return notes.map((note, i) => ({ note, ...held[i] })).filter((x) => x.units > 0n);
}

/** The units of a note in the Issuer's inventory. */
export async function inventoryOf(n: DemoNote): Promise<number> {
  const { s } = context();
  return Number(await s.publicClient.readContract({ address: n.addresses.note as Address, abi: NOTE, functionName: "balanceOf", args: [s.address("issuer")] }));
}

/** The note's total units outstanding. */
export async function totalOf(n: DemoNote): Promise<number> {
  const { s } = context();
  return Number(await s.publicClient.readContract({ address: n.addresses.note as Address, abi: NOTE, functionName: "totalSupply" }));
}

/** Units of the note each onboarded account holds, for the note page's choices. */
export async function holdersOf(n: DemoNote): Promise<Map<string, bigint>> {
  const { s } = context();
  const all = (await getStore().listAdmissions(500)).filter((a) => a.status === "onboarded" && walletOf(a));
  const units = await Promise.all(all.map((a) => s.publicClient.readContract({ address: n.addresses.note as Address, abi: NOTE, functionName: "balanceOf", args: [walletOf(a)] }).catch(() => 0n)));
  return new Map(all.map((a, i) => [a.id, units[i]]));
}

/** Kept for notes issued before locked settlement: their placements, as the site recorded them. */
export type Placement = {
  id: string;
  admission: string;
  buyer: string;
  route: string;
  units: number;
  priceCents: string;
  status: "offered" | "settled" | "cancelled";
  offeredAt: string;
  by: string;
  txs: Record<string, string>;
};
