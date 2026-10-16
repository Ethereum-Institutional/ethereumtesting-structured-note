import "server-only";
import { parseAbi, parseAbiItem, type Address } from "viem";
import { addressBook } from "../chain/manifest.ts";
import { client, deploymentBlock, noteContracts, withCustodyAccounts } from "../ledger.ts";
import { getStore } from "../store.ts";
import { lifecycleOf } from "./lifecycle.ts";
import { offersOf } from "./place.ts";
import { chainClient, type NoteOnRecord } from "./registry.ts";
import { termSheetOfNote, type NoteTermSheet } from "./termsheets.ts";
import { accountNamer } from "../identity/names.ts";

/**
 * A note's reconciliation statement (ADR 0094), generalising its close-out statement (S-33,
 * ADR 0084) to any moment of its life: as at the close of a day, now, or a block. Read from the
 * chain alone, every figure at the one block, so anyone with the chain can reproduce it.
 *
 * It sets out each holder's position (units in and out, balance, units locked by open offers,
 * whether it is eligible, the cash it was paid and anything held for it), the cash the Paying Agent
 * and the settlement contract hold and the Agent's funding, every distribution due, paid and held,
 * and the open offers. Its checks hold on any day: the supply is the sum of the balances, every
 * position reconciles, every holder is eligible, the locked units are the open offers', the Paying
 * Agent holds exactly what it owes, and the term sheet the note carries gives exactly its terms. Once the note has redeemed, the close-out's checks are
 * added, and the statement says closed when every check passes.
 */

const NOTE = parseAbi([
  "function totalSupply() view returns (uint256)",
  "function balanceOf(address) view returns (uint256)",
  "function paused() view returns (bool)",
  "function getFrozenTokens(address) view returns (uint256)",
]);
const CASH = parseAbi(["function balanceOf(address) view returns (uint256)", "function allowance(address owner, address spender) view returns (uint256)"]);
const PAYING = parseAbi(["function INVENTORY() view returns (address)", "function FUNDER() view returns (address)"]);
const REGISTRY = parseAbi(["function isVerified(address) view returns (bool)"]);
const TRANSFER = parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 value)");
const ZERO = "0x0000000000000000000000000000000000000000";

export type AsAt = { kind: "now" } | { kind: "day"; day: string } | { kind: "block"; block: bigint };
export type Check = { label: string; ok: boolean; detail: string };
export type Position = {
  account: Address;
  label: string | null;
  /** Units received: by issuance, placement or transfer. */
  unitsIn: string;
  /** Units given up: by transfer, buy-back or redemption. */
  unitsOut: string;
  balance: string;
  /** Units locked by the account's open offers. */
  lockedUnits: string;
  /** Whether the note's identity registry verifies the account at the block. */
  eligible: boolean;
  couponCents: string;
  redemptionCents: string;
  heldCents: string;
};
export type Distribution = {
  date: number;
  kind: "coupon" | "redemption";
  recordTime: number;
  paymentDate: number;
  perCaCents: string;
  state: "open" | "closed";
  unitsEntitled: string;
  unitsPaid: string;
  paidCents: string;
  heldCents: string;
  /** What the Paying Agent still owes the units not yet paid. */
  remainingCents: string;
};
export type OpenOffer = { id: string; kind: string; side: string; proposer: Address; counterparty: Address | null; units: number; priceCents: string; deadline: number };
export type Statement = {
  note: { token: Address; name: string; symbol: string; underReview: boolean };
  chainId: number;
  block: string;
  at: string;
  asAt: string;
  state: "open" | "redeemed" | "closed";
  closed: boolean;
  supply: string;
  inventory: { account: Address; units: string };
  checks: Check[];
  positions: Position[];
  totals: { couponCents: string; redemptionCents: string; heldCents: string; units: string };
  cash: {
    payingAgentCents: string;
    owedByPayingAgentCents: string;
    settlementCents: string;
    funder: { account: Address; balanceCents: string; allowanceCents: string };
  };
  distributions: Distribution[];
  openOffers: OpenOffer[];
  /** The term sheet the note's identity names (ADR 0095). */
  termSheet: { hash: string; uri: string; held: boolean; differences: string[] } | null;
};

const euros = (cents: bigint) => `€${(Number(cents) / 100).toLocaleString("en-GB", { minimumFractionDigits: 2 })}`;

/** The block a statement is read at: the last block of the day (UTC) for a day, the latest for now. */
export async function blockFor(asAt: AsAt, from: bigint): Promise<{ block: bigint; label: string }> {
  const { c } = chainClient();
  const head = await c.getBlock();
  if (asAt.kind === "now") return { block: head.number, label: "now" };
  if (asAt.kind === "block") {
    if (asAt.block > head.number) throw new Error(`Block ${asAt.block} is not yet mined; the latest is ${head.number}.`);
    if (asAt.block < from) throw new Error(`Block ${asAt.block} is before the note was issued, at block ${from}.`);
    return { block: asAt.block, label: `block ${asAt.block}` };
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(asAt.day)) throw new Error("Give the day as YYYY-MM-DD.");
  const end = Date.parse(`${asAt.day}T23:59:59Z`) / 1000;
  if (Number.isNaN(end)) throw new Error("Give the day as YYYY-MM-DD.");
  const label = `the close of ${asAt.day} (UTC)`;
  if (Number(head.timestamp) <= end) return { block: head.number, label: `${label}, so far` };
  // The last block at or before the end of the day.
  let lo = from;
  let hi = head.number;
  const first = await c.getBlock({ blockNumber: lo });
  if (Number(first.timestamp) > end) throw new Error(`The note was issued after ${asAt.day}.`);
  while (lo < hi) {
    const mid = (lo + hi + 1n) / 2n;
    if (Number((await c.getBlock({ blockNumber: mid })).timestamp) <= end) lo = mid;
    else hi = mid - 1n;
  }
  return { block: lo, label };
}

/** The days a note has a statement for: from its issuance to the chain's latest day, newest first. */
export async function daysOf(rec: NoteOnRecord, limit = 31): Promise<string[]> {
  const { c } = chainClient();
  const head = Number((await c.getBlock()).timestamp);
  const days: string[] = [];
  for (let t = head; t >= rec.issuedAt - 86_400 && days.length < limit; t -= 86_400) {
    const day = new Date(t * 1000).toISOString().slice(0, 10);
    if (day >= new Date(rec.issuedAt * 1000).toISOString().slice(0, 10) && !days.includes(day)) days.push(day);
  }
  return days;
}

/** Names for accounts: the deployment's, the site's notes' contracts, and the clients the site onboarded. */
async function names(): Promise<(a: Address) => string | null> {
  const { m } = chainClient();
  const c = client(m);
  const from = await deploymentBlock(c, m);
  const [withCustody, notes, admissions] = await Promise.all([withCustodyAccounts(c, m, from), noteContracts(), getStore().listAdmissions(1000)]);
  const map = new Map<string, string>();
  for (const [a, v] of addressBook(withCustody)) map.set(a, v.label);
  for (const n of notes) map.set(n.address.toLowerCase(), n.label);
  const nameOf = await accountNamer();
  for (const a of admissions) {
    const d = a.data as Record<string, any>;
    if (d.wallet) map.set(String(d.wallet).toLowerCase(), nameOf(a));
  }
  return (a) => map.get(a.toLowerCase()) ?? null;
}

export async function statementOf(rec: NoteOnRecord, asAt: AsAt = { kind: "now" }): Promise<Statement> {
  const { m, c } = chainClient();
  const n = rec.note;
  const token = rec.token;
  const deposit = m.assets.deposit!.address as Address;
  const pa = n.addresses.payingAgent as Address;
  const settlement = n.addresses.settlement as Address;
  const registry = n.addresses.identityRegistry as Address;
  const { block: atBlock, label } = await blockFor(asAt, rec.issuedBlock);
  const pin = { blockNumber: atBlock };

  const [block, supply, paused, life, transfers, offers, inventory, funder, label_, sheet] = await Promise.all([
    c.getBlock(pin),
    c.readContract({ address: token, abi: NOTE, functionName: "totalSupply", ...pin }),
    c.readContract({ address: token, abi: NOTE, functionName: "paused", ...pin }),
    lifecycleOf(n, atBlock),
    c.getLogs({ address: token, event: TRANSFER, fromBlock: rec.issuedBlock, toBlock: atBlock }),
    offersOf(n, atBlock),
    c.readContract({ address: pa, abi: PAYING, functionName: "INVENTORY" }),
    c.readContract({ address: pa, abi: PAYING, functionName: "FUNDER" }),
    names(),
    termSheetOfNote(token, n.addresses.determinations as Address, atBlock).catch((): NoteTermSheet | null => null),
  ]);
  const [paCash, settlementCash, funderCash, funderAllowance, inventoryUnits] = await Promise.all([
    c.readContract({ address: deposit, abi: CASH, functionName: "balanceOf", args: [pa], ...pin }),
    c.readContract({ address: deposit, abi: CASH, functionName: "balanceOf", args: [settlement], ...pin }),
    c.readContract({ address: deposit, abi: CASH, functionName: "balanceOf", args: [funder], ...pin }),
    c.readContract({ address: deposit, abi: CASH, functionName: "allowance", args: [funder, pa], ...pin }),
    c.readContract({ address: token, abi: NOTE, functionName: "balanceOf", args: [inventory], ...pin }),
  ]);

  // Every account the note ever moved to or from, and what it received and gave up.
  const flows = new Map<string, { account: Address; in: bigint; out: bigint }>();
  const flow = (a: Address) => flows.get(a.toLowerCase()) ?? flows.set(a.toLowerCase(), { account: a, in: 0n, out: 0n }).get(a.toLowerCase())!;
  for (const l of transfers) {
    const { from, to, value } = l.args as { from: Address; to: Address; value: bigint };
    if (to.toLowerCase() !== ZERO) flow(to).in += value;
    if (from.toLowerCase() !== ZERO) flow(from).out += value;
  }
  const accounts = [...flows.values()];
  const [balances, frozen, verified] = await Promise.all([
    Promise.all(accounts.map((f) => c.readContract({ address: token, abi: NOTE, functionName: "balanceOf", args: [f.account], ...pin }))),
    Promise.all(accounts.map((f) => c.readContract({ address: token, abi: NOTE, functionName: "getFrozenTokens", args: [f.account], ...pin }).catch(() => 0n))),
    Promise.all(accounts.map((f) => c.readContract({ address: registry, abi: REGISTRY, functionName: "isVerified", args: [f.account], ...pin }).catch(() => false))),
  ]);

  // What each was paid, and anything still held for it; and each distribution's account.
  const paid = new Map<string, { coupon: bigint; redemption: bigint; held: bigint }>();
  const pay = (a: string) => paid.get(a.toLowerCase()) ?? paid.set(a.toLowerCase(), { coupon: 0n, redemption: 0n, held: 0n }).get(a.toLowerCase())!;
  const distributions: Distribution[] = [];
  for (const d of life.dates) {
    for (const e of d.events) {
      let paidCents = 0n;
      let heldCents = 0n;
      for (const p of e.payments) {
        if (p.held) {
          pay(p.holder).held += BigInt(p.amount);
          heldCents += BigInt(p.amount);
        } else {
          if (e.kind === "coupon") pay(p.holder).coupon += BigInt(p.amount);
          else pay(p.holder).redemption += BigInt(p.amount);
          paidCents += BigInt(p.amount);
        }
      }
      const remaining = e.closed ? 0n : BigInt(e.perCaCents) * (BigInt(e.unitsEntitled) - BigInt(e.unitsPaid));
      distributions.push({
        date: d.index,
        kind: e.kind,
        recordTime: d.recordTime,
        paymentDate: d.paymentDate,
        perCaCents: e.perCaCents,
        state: e.closed ? "closed" : "open",
        unitsEntitled: e.unitsEntitled,
        unitsPaid: e.unitsPaid,
        paidCents: String(paidCents),
        heldCents: String(heldCents),
        remainingCents: String(remaining),
      });
    }
  }

  const positions: Position[] = accounts.map((f, i) => {
    const p = paid.get(f.account.toLowerCase()) ?? { coupon: 0n, redemption: 0n, held: 0n };
    return {
      account: f.account,
      label: label_(f.account),
      unitsIn: String(f.in),
      unitsOut: String(f.out),
      balance: String(balances[i]),
      lockedUnits: String(frozen[i]),
      eligible: verified[i],
      couponCents: String(p.coupon),
      redemptionCents: String(p.redemption),
      heldCents: String(p.held),
    };
  });
  const sum = (k: "couponCents" | "redemptionCents" | "heldCents") => positions.reduce((t, p) => t + BigInt(p[k]), 0n);
  const held = sum("heldCents");
  const totals = { couponCents: String(sum("couponCents")), redemptionCents: String(sum("redemptionCents")), heldCents: String(held), units: String(balances.reduce((t, b) => t + b, 0n)) };
  const owed = distributions.reduce((t, d) => t + BigInt(d.remainingCents), 0n) + held;
  const openOffers = offers.filter((o) => o.status === "offered");
  const lockedByOffers = openOffers.filter((o) => o.side === "sell").reduce((t, o) => t + BigInt(o.units), 0n);
  const locked = frozen.reduce((t, f) => t + f, 0n);

  const holding = positions.filter((p) => p.balance !== "0");
  const unbalanced = positions.filter((p) => BigInt(p.unitsIn) - BigInt(p.unitsOut) !== BigInt(p.balance));
  const ineligible = holding.filter((p) => !p.eligible);
  const checks: Check[] = [
    { label: "The supply is the sum of the balances", ok: supply === BigInt(totals.units), detail: `${supply} units outstanding; the balances sum to ${totals.units}` },
    { label: "Every position reconciles", ok: unbalanced.length === 0, detail: unbalanced.length ? `${unbalanced.length} account(s) whose units in less units out differ from their balance` : "for every account, units received less units given up equals its balance" },
    { label: "Every holder is eligible for the note", ok: ineligible.length === 0, detail: ineligible.length ? `${ineligible.length} holder(s) the note's registry does not verify at this block` : `all ${holding.length} holder(s) verified by the note's identity registry` },
    { label: "The locked units are the open offers'", ok: locked === lockedByOffers, detail: `${locked} unit(s) locked; open offers to sell lock ${lockedByOffers}` },
    { label: "The Paying Agent holds what it owes", ok: paCash === owed, detail: `${euros(paCash)} held; ${euros(owed)} owed: the unpaid part of open distributions and ${euros(held)} held for holders` },
    { label: "The settlement contract holds no cash between settlements", ok: settlementCash === 0n, detail: `${euros(settlementCash)} of the deposit` },
    {
      label: "The term sheet matches the note",
      ok: Boolean(sheet?.record) && sheet!.differences.length === 0,
      detail: !sheet
        ? "the note's identity names no term sheet"
        : !sheet.record
          ? `the term sheet ${sheet.hash} the note's identity names is not held here`
          : sheet.differences.length
            ? `the terms on the chain differ: ${sheet.differences.join("; ")}`
            : `the record at ${sheet.hash} gives exactly the terms the Determination Agent holds`,
    },
  ];
  if (life.terminated) {
    const open = distributions.filter((d) => d.state === "open");
    checks.push(
      { label: "Supply is zero", ok: supply === 0n, detail: `${supply} units outstanding` },
      { label: "The note is redeemed", ok: paused, detail: paused ? "terminated and paused" : "terminated, not paused" },
      { label: "The holder list is empty", ok: holding.length === 0, detail: holding.length ? `${holding.length} account(s) still hold units` : `all ${positions.length} accounts that held units hold none, the Issuer's inventory included` },
      { label: "Every distribution is paid in full", ok: open.length === 0 && distributions.length > 0, detail: distributions.length === 0 ? "no distribution was made" : open.length ? `${open.length} distribution(s) not closed` : `${distributions.length} distribution(s), each closed with every entitled unit paid` },
      { label: "Nothing is held for a holder", ok: held === 0n, detail: held === 0n ? "no payment awaits a holder" : `${euros(held)} still held` },
      { label: "The Paying Agent holds no cash", ok: paCash === 0n, detail: `${euros(paCash)} of the deposit` },
      { label: "No offer is open, and no unit is locked", ok: openOffers.length === 0 && locked === 0n, detail: openOffers.length || locked ? `${openOffers.length} open offer(s), ${locked} unit(s) locked` : "none" },
    );
  }
  const closed = life.terminated && checks.every((x) => x.ok);

  return {
    note: { token, name: rec.name, symbol: rec.symbol, underReview: rec.underReview },
    chainId: m.chainId,
    block: String(atBlock),
    at: new Date(Number(block.timestamp) * 1000).toISOString(),
    asAt: label,
    state: closed ? "closed" : life.terminated ? "redeemed" : "open",
    closed,
    supply: String(supply),
    inventory: { account: inventory, units: String(inventoryUnits) },
    checks,
    positions,
    totals,
    cash: {
      payingAgentCents: String(paCash),
      owedByPayingAgentCents: String(owed),
      settlementCents: String(settlementCash),
      funder: { account: funder, balanceCents: String(funderCash), allowanceCents: String(funderAllowance) },
    },
    distributions,
    termSheet: sheet ? { hash: sheet.hash, uri: sheet.uri, held: Boolean(sheet.record), differences: sheet.differences } : null,
    openOffers: openOffers.map((o) => ({ id: o.id, kind: o.kind, side: o.side, proposer: o.proposer, counterparty: o.counterparty, units: o.units, priceCents: o.priceCents, deadline: o.deadline })),
  };
}

const cents = (v: string) => (Number(v) / 100).toFixed(2);
const field = (v: string) => (/[",\n]/.test(v) ? `"${v.replaceAll('"', '""')}"` : v);

/** The positions as CSV, for a bank's reconciliation tools: one row per account, amounts in euros. */
export function positionsCsv(s: Statement): string {
  const head = ["note", "block", "as_at", "account", "name", "units_in", "units_out", "balance", "locked_units", "eligible", "coupons_eur", "redemption_eur", "held_eur"];
  const rows = s.positions.map((p) =>
    [s.note.symbol, s.block, s.asAt, p.account, p.label ?? "", p.unitsIn, p.unitsOut, p.balance, p.lockedUnits, p.eligible ? "yes" : "no", cents(p.couponCents), cents(p.redemptionCents), cents(p.heldCents)].map(field).join(","),
  );
  return [head.join(","), ...rows].join("\n") + "\n";
}

/** Reads `asAt` from a query: a day (YYYY-MM-DD), "now", or "block:N". */
export function parseAsAt(v: string | null | undefined): AsAt {
  if (!v || v === "now") return { kind: "now" };
  if (/^block:\d+$/.test(v)) return { kind: "block", block: BigInt(v.slice(6)) };
  return { kind: "day", day: v };
}
