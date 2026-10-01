import "server-only";
import { decodeEventLog, defineChain, encodeFunctionData, parseAbi, type Address, type Hex } from "viem";
import { loadManifest } from "../chain/manifest.ts";
import { signers } from "../chain/signer.ts";
import { getStore, type Admission, type DemoNote, type Registrant } from "../store.ts";
import { isOperator } from "../operators.ts";

/**
 * Selling restrictions and placement (ADR 0075; S-08, S-09).
 *
 * - **Approval for the note.** Staff confirm a client may take the note under Regulation S, and the
 *   Access Issuer rewrites the account's registry grant with the Reg S flag, keeping its expiry,
 *   credential reference and commitment.
 * - **Placement by DvP.** The Issuer offers units from its inventory at a price in the deposit; the
 *   buyer accepts, and both legs settle in that one transaction or neither does. A custody account
 *   accepts through the custodian at once; a client's own wallet accepts in MetaMask.
 *
 * Before anything is sent the site asks the note whether its leg could move, so a placement the
 * gate would refuse (no Reg S flag) or the record-date engine would stop is refused with its reason.
 */

const REGISTRY = parseAbi([
  "function grant(address account, uint32 flags, uint16 jurisdiction, uint40 expiresAt, bytes32 credentialRef, bytes32 commitment)",
  "function grantOf(address account) view returns ((uint32 flags, uint16 jurisdiction, uint16 registrar, uint40 grantedAt, uint40 expiresAt))",
  "function credentialRefOf(address) view returns (bytes32)",
  "function commitmentOf(address) view returns (bytes32)",
  "function REG_S() view returns (uint32)",
]);
const NOTE = parseAbi([
  "function approve(address spender, uint256 value) returns (bool)",
  "function canTransfer(address from, address to, uint256 value) view returns (bool)",
  "function balanceOf(address) view returns (uint256)",
]);
const DETERMINATIONS = parseAbi(["function transfersOpen() view returns (bool)"]);
const SETTLEMENT = parseAbi([
  "function propose(address seller, address buyer, uint64 units, uint256 price, uint48 deadline) returns (uint256 id)",
  "function accept(uint256 id)",
  "function cancel(uint256 id)",
  "function trades(uint256) view returns (address seller, address buyer, address proposer, uint64 units, uint48 deadline, uint8 state, uint256 price)",
  "event Proposed(uint256 indexed id, address indexed seller, address indexed buyer, address proposer, uint256 units, uint256 price, uint256 deadline)",
]);
const DEPOSIT = parseAbi(["function approve(address spender, uint256 value) returns (bool)", "function balanceOf(address) view returns (uint256)"]);
const ACCOUNT = parseAbi(["function execute((address target, uint256 value, bytes data)[] calls) returns (bytes[])"]);

const PLACEMENT_HOURS = 24;
const now = () => new Date().toISOString();

export type Placement = {
  id: string; // the settlement contract's trade id
  admission: string;
  buyer: string;
  route: string;
  units: number;
  priceCents: string; // the whole price, in the deposit's cents
  status: "offered" | "settled" | "cancelled";
  offeredAt: string;
  by: string;
  txs: Record<string, string>;
};

function context() {
  const m = loadManifest();
  const rpc = process.env.RPC_URL?.trim();
  if (!rpc) throw new Error("RPC_URL is not set");
  const chain = defineChain({ id: m.chainId, name: `chain ${m.chainId}`, nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [rpc] } } });
  return { m, s: signers(chain, rpc) };
}

/**
 * Reads until `ok`, for up to about ten seconds. Just after a transaction, a load-balanced RPC may
 * answer from the block before it (ADR 0059); a step that relies on the last one waits for it.
 */
async function until<T>(read: () => Promise<T>, ok: (v: T) => boolean): Promise<T> {
  let v = await read();
  for (let tries = 0; tries < 7 && !ok(v); tries++) {
    await new Promise((r) => setTimeout(r, 1500));
    v = await read();
  }
  return v;
}

const walletOf = (a: Admission) => ((a.data as Record<string, any>).assessment?.summary?.wallet ?? "") as Address;

/** Whether the account's live registry grant carries the Reg S flag. */
export async function hasRegS(account: Address): Promise<boolean> {
  const { m, s } = context();
  const r = m.instruments!.registry;
  const [g, flag] = await Promise.all([
    s.publicClient.readContract({ address: r, abi: REGISTRY, functionName: "grantOf", args: [account] }),
    s.publicClient.readContract({ address: r, abi: REGISTRY, functionName: "REG_S" }),
  ]);
  return Number(g.expiresAt) > Date.now() / 1000 && (g.flags & flag) === flag;
}

/** Staff approve an onboarded account for the note under Regulation S (ADR 0075). */
export async function approveForNote(staff: Registrant, admissionId: string): Promise<Hex> {
  if (!isOperator(staff.email)) throw new Error("Not permitted.");
  const store = getStore();
  const a = await store.admissionById(admissionId);
  if (!a || a.status !== "admitted") throw new Error("Only an admitted account can be approved for the note.");
  const { m, s } = context();
  const r = m.instruments!.registry;
  const account = walletOf(a);
  const [g, flag, ref, commitment] = await Promise.all([
    s.publicClient.readContract({ address: r, abi: REGISTRY, functionName: "grantOf", args: [account] }),
    s.publicClient.readContract({ address: r, abi: REGISTRY, functionName: "REG_S" }),
    s.publicClient.readContract({ address: r, abi: REGISTRY, functionName: "credentialRefOf", args: [account] }),
    s.publicClient.readContract({ address: r, abi: REGISTRY, functionName: "commitmentOf", args: [account] }),
  ]);
  if (Number(g.expiresAt) <= Date.now() / 1000) throw new Error("The account has no live registry grant to add the flag to.");
  if ((g.flags & flag) === flag) throw new Error("The account is already approved for the note.");
  const tx = await s.send("accessIssuer", { address: r, abi: REGISTRY, functionName: "grant", args: [account, g.flags | flag, g.jurisdiction, g.expiresAt, ref, commitment] });
  await until(() => hasRegS(account), Boolean); // so what follows sees the approval
  const latest = (await store.admissionById(a.id))!;
  const d = latest.data as Record<string, any>;
  await store.updateAdmission({ ...latest, data: { ...d, regS: { by: staff.email, at: now(), tx } } }, latest.status);
  await store.audit({ at: now(), actor: staff.email, action: `approved ${account} for the note under Regulation S`, subject: a.id });
  return tx;
}

async function recordPlacement(n: DemoNote, p: Placement) {
  const store = getStore();
  for (let tries = 0; tries < 5; tries++) {
    const latest = (await store.noteById(n.id))!;
    const placements = ((latest.data.placements ?? []) as Placement[]).filter((x) => x.id !== p.id);
    if (await store.updateNote({ ...latest, data: { ...latest.data, placements: [...placements, p] } }, latest.step)) return;
  }
  throw new Error("The note changed while recording the placement; look again.");
}

/**
 * Staff place units with an approved account (S-08). The Issuer allows the settlement contract its
 * units and offers them; a custody account accepts through the custodian in the same action.
 */
export async function placeUnits(staff: Registrant, noteId: string, admissionId: string, units: number, pricePerUnitCents: bigint): Promise<Placement> {
  if (!isOperator(staff.email)) throw new Error("Not permitted.");
  const store = getStore();
  const n = await store.noteById(noteId);
  if (!n || n.status !== "issued") throw new Error("That note is not issued.");
  const a = await store.admissionById(admissionId);
  if (!a || a.status !== "admitted") throw new Error("Place only with an admitted account.");
  if (!Number.isInteger(units) || units < 1) throw new Error("Place at least one unit.");
  if (pricePerUnitCents <= 0n) throw new Error("The price must be more than zero.");
  const { m, s } = context();
  const buyer = walletOf(a);
  const issuer = s.address("issuer");
  const note = n.addresses.note as Address;
  const settlement = n.addresses.settlement as Address;
  const price = pricePerUnitCents * BigInt(units);

  // The note's own answer, before anything is sent.
  const [inventory, open, could] = await Promise.all([
    s.publicClient.readContract({ address: note, abi: NOTE, functionName: "balanceOf", args: [issuer] }),
    s.publicClient.readContract({ address: n.addresses.determinations as Address, abi: DETERMINATIONS, functionName: "transfersOpen" }),
    until(() => s.publicClient.readContract({ address: note, abi: NOTE, functionName: "canTransfer", args: [issuer, buyer, BigInt(units)] }), Boolean),
  ]);
  if (inventory < BigInt(units)) throw new Error(`The Issuer's inventory holds ${inventory} units, not ${units}.`);
  if (!open) throw new Error("Transfers are stopped from a record time until its determination (ADR 0010); place once it is determined.");
  if (!could) {
    throw new Error((await hasRegS(buyer)) ? "The note refuses this placement." : "The account is not approved for the note: its registry grant lacks the Reg S flag (S-09). Approve it first, under Admissions.");
  }

  const allowance = await s.send("issuer", { address: note, abi: NOTE, functionName: "approve", args: [settlement, BigInt(units)] });
  const deadline = Math.floor(Date.now() / 1000) + PLACEMENT_HOURS * 3600;
  const proposed = await s.send("issuer", { address: settlement, abi: SETTLEMENT, functionName: "propose", args: [issuer, buyer, BigInt(units), price, deadline] });
  const receipt = await s.publicClient.getTransactionReceipt({ hash: proposed });
  const event = receipt.logs
    .map((l) => {
      try {
        return decodeEventLog({ abi: SETTLEMENT, data: l.data, topics: l.topics });
      } catch {
        return null;
      }
    })
    .find((e) => e?.eventName === "Proposed");
  if (!event) throw new Error("The offer was sent, but its trade number was not found in the receipt.");
  const p: Placement = {
    id: String((event.args as { id: bigint }).id),
    admission: a.id,
    buyer,
    route: a.route,
    units,
    priceCents: String(price),
    status: "offered",
    offeredAt: now(),
    by: staff.email,
    txs: { allowance, proposed },
  };
  await recordPlacement(n, p);
  // The offer must be visible before anyone accepts it.
  await until(() => s.publicClient.readContract({ address: settlement, abi: SETTLEMENT, functionName: "trades", args: [BigInt(p.id)] }), (t) => Number(t[5]) === 1);
  await store.audit({ at: now(), actor: staff.email, action: `offered ${units} units of ${n.symbol} to ${buyer} for ${price} cents, trade ${p.id}`, subject: n.id });

  if (a.route === "custodied") {
    // On the client's instruction: the custodian accepts for the account, both calls in one transaction.
    const accepted = await s.send("custodian", {
      address: buyer,
      abi: ACCOUNT,
      functionName: "execute",
      args: [[
        { target: m.assets.deposit!.address as Address, value: 0n, data: encodeFunctionData({ abi: DEPOSIT, functionName: "approve", args: [settlement, price] }) },
        { target: settlement, value: 0n, data: encodeFunctionData({ abi: SETTLEMENT, functionName: "accept", args: [BigInt(p.id)] }) },
      ]],
    });
    const settled = { ...p, status: "settled" as const, txs: { ...p.txs, accepted } };
    await recordPlacement(n, settled);
    await store.audit({ at: now(), actor: staff.email, action: `the custodian accepted trade ${p.id} for ${buyer}: ${units} units of ${n.symbol} settled against ${price} cents`, subject: n.id });
    return settled;
  }
  return p;
}

/** The transactions a client's own wallet sends to accept an offer: the deposit's allowance, then the acceptance. */
export async function acceptanceFor(client: Registrant, noteId: string, tradeId: string, address: string) {
  const store = getStore();
  const n = await store.noteById(noteId);
  const p = ((n?.data.placements ?? []) as Placement[]).find((x) => x.id === tradeId);
  if (!n || !p || p.status !== "offered") throw new Error("That offer is not open.");
  const a = await store.admissionById(p.admission);
  if (!a || a.registrantId !== client.id) throw new Error("That offer is not yours.");
  if (p.buyer.toLowerCase() !== address.toLowerCase()) throw new Error(`The wallet connected is ${address}; the offer is to ${p.buyer}.`);
  const { m, s } = context();
  const held = await s.publicClient.readContract({ address: m.assets.deposit!.address as Address, abi: DEPOSIT, functionName: "balanceOf", args: [p.buyer as Address] });
  if (held < BigInt(p.priceCents)) throw new Error(`The wallet holds ${held} cents of the deposit; the price is ${p.priceCents}. Ask your bank to credit the deposit.`);
  const settlement = n.addresses.settlement as Address;
  return [
    { to: m.assets.deposit!.address as Address, data: encodeFunctionData({ abi: DEPOSIT, functionName: "approve", args: [settlement, BigInt(p.priceCents)] }), label: "Allow the settlement contract the price" },
    { to: settlement, data: encodeFunctionData({ abi: SETTLEMENT, functionName: "accept", args: [BigInt(p.id)] }), label: `Accept ${p.units} units of ${n.symbol}` },
  ];
}

/** Brings an offer's record up to date with the chain: settled, cancelled, or still offered. */
export async function refreshPlacement(noteId: string, tradeId: string, acceptedTx?: string): Promise<Placement | null> {
  const store = getStore();
  const n = await store.noteById(noteId);
  const p = ((n?.data.placements ?? []) as Placement[]).find((x) => x.id === tradeId);
  if (!n || !p) return null;
  const { s } = context();
  // Read again for a few seconds: just after the acceptance a lagging RPC may still report it offered.
  for (let tries = 0; tries < 6; tries++) {
    const t = await s.publicClient.readContract({ address: n.addresses.settlement as Address, abi: SETTLEMENT, functionName: "trades", args: [BigInt(p.id)] });
    const state = Number(t[5]); // 1 Proposed, 2 Settled, 3 Cancelled
    if (state === 2 || state === 3) {
      const next = { ...p, status: state === 2 ? ("settled" as const) : ("cancelled" as const), txs: { ...p.txs, ...(acceptedTx ? { accepted: acceptedTx } : {}) } };
      await recordPlacement(n, next);
      return next;
    }
    if (!acceptedTx) break;
    await new Promise((r) => setTimeout(r, 1500));
  }
  return p;
}

/** The offers open to a client, across every note. */
export async function offersFor(client: Registrant): Promise<Array<{ note: DemoNote; placement: Placement }>> {
  const store = getStore();
  const mine = new Set((await store.admissionsFor(client.id)).map((a) => a.id));
  return (await store.listNotes()).flatMap((note) =>
    ((note.data.placements ?? []) as Placement[]).filter((p) => p.status === "offered" && mine.has(p.admission)).map((placement) => ({ note, placement })),
  );
}

/** Staff withdraw an offer not yet accepted: the settlement contract cancels it, and nothing moved. */
export async function cancelPlacement(staff: Registrant, noteId: string, tradeId: string): Promise<void> {
  if (!isOperator(staff.email)) throw new Error("Not permitted.");
  const store = getStore();
  const n = await store.noteById(noteId);
  const p = ((n?.data.placements ?? []) as Placement[]).find((x) => x.id === tradeId);
  if (!n || !p || p.status !== "offered") throw new Error("That offer is not open.");
  const { s } = context();
  const cancelled = await s.send("issuer", { address: n.addresses.settlement as Address, abi: SETTLEMENT, functionName: "cancel", args: [BigInt(p.id)] });
  await recordPlacement(n, { ...p, status: "cancelled", txs: { ...p.txs, cancelled } });
  await store.audit({ at: now(), actor: staff.email, action: `withdrew the offer of ${p.units} units of ${n.symbol} to ${p.buyer}, trade ${p.id}`, subject: n.id });
}

/** The units of each issued note an account holds. */
export async function holdingsOf(account: Address): Promise<Array<{ note: DemoNote; units: bigint }>> {
  const { s } = context();
  const notes = (await getStore().listNotes()).filter((n) => n.status === "issued" && n.addresses.note);
  const held = await Promise.all(
    notes.map((n) => s.publicClient.readContract({ address: n.addresses.note as Address, abi: NOTE, functionName: "balanceOf", args: [account] }).catch(() => 0n)),
  );
  return notes.map((note, i) => ({ note, units: held[i] })).filter((x) => x.units > 0n);
}

/** The units of a note still in the Issuer's inventory, to place. */
export async function inventoryOf(n: DemoNote): Promise<number> {
  const { s } = context();
  return Number(await s.publicClient.readContract({ address: n.addresses.note as Address, abi: NOTE, functionName: "balanceOf", args: [s.address("issuer")] }));
}
