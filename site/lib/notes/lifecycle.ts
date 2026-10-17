import "server-only";
import { defineChain, encodeFunctionData, parseAbi, type Address, type Hex } from "viem";
import { loadManifest } from "../chain/manifest.ts";
import { signers } from "../chain/signer.ts";
import { execThroughWallet } from "../chain/safe.ts";
import { until } from "../chain/until.ts";
import { getStore, type DemoNote, type Job, type Registrant } from "../store.ts";
import { createJob, jobsFor, runToEnd, type StepResult } from "../jobs.ts";
import { indexed } from "../chain/events.ts";
import { hasDuty, isOperator } from "../operators.ts";
import { stretch } from "./calendar.ts";
import { SCENARIOS } from "./issue.ts";
import { releaseOpenOffers } from "./place.ts";

/**
 * A note's life after placement: each scheduled date determined, then its coupon and
 * any redemption paid to the holders of record, until the note is redeemed and closed.
 *
 * - **Determination.** The Calculation Agent signs the date's Levels and the outcome the
 *   Determination Agent computes from them; the contract recomputes it and accepts only an
 *   identical one. Levels come from the scenario, and staff may change them before determining.
 * - **Payment.** The Agent approves the Paying Agent for exactly the event's amount, and the
 *   servicing wallet, a two-of-three multi-signature wallet, opens the event after its payment
 *   date (drawing that amount from the Agent's deposit) and pays the holders of record in batches. Holders are found from the note's own transfers and their
 *   units read at the Record Time, so the Register is the chain's.
 * - **The model.** On a four-date note, each outcome is checked against the independent payoff
 *   model's expected payments for the scenario.
 *
 * Times are the chain's: a date is due when the latest block is past it.
 */

const OUTCOME = "(bool breached, bool couponPaid, uint64 couponPerCa, bool redeemed, uint64 redemptionPerCa, uint8 worstIndex)";
const DETERMINATIONS = parseAbi([
  `function compute(uint256 dateIndex, uint256[] levels) view returns (${OUTCOME} out, uint256 missedAfter)`,
  `function digest(uint256 dateIndex, uint256[] levels, ${OUTCOME} o) view returns (bytes32)`,
  `function determine(uint256 dateIndex, uint256[] levels, ${OUTCOME} claimed, bytes signature)`,
  "function observationCount() view returns (uint256)",
  "function observation(uint256 dateIndex) view returns ((uint48 date, uint48 recordTime, uint48 paymentDate, bool coupon, bool mer, bool barrier, bool isFinal, uint32 merTriggerBps))",
  "function determined(uint256 dateIndex) view returns (bool)",
  `function outcomeOf(uint256 dateIndex) view returns (${OUTCOME})`,
  "function levelsOf(uint256 dateIndex) view returns (uint256[])",
  "function nextDate() view returns (uint256)",
  "function terminated() view returns (bool)",
  "error NotNextDate(uint256 dateIndex, uint256 next)",
  "error BeforeScheduledDate(uint256 dateIndex, uint48 date)",
  "error Terminated()",
  "error InvalidLevels()",
  `error OutcomeDisagrees(${OUTCOME} computed)`,
  "error BadSignature()",
]);
const PAYING = parseAbi([
  "function open(uint256 dateIndex, uint8 kind) returns (bytes32 id)",
  "function pay(bytes32 id, address[] holders)",
  "function claim(bytes32 id, address holder)",
  "function idOf(uint256 dateIndex, uint8 kind) pure returns (bytes32)",
  "function distributions(bytes32 id) view returns (uint48 recordTime, uint64 perCa, uint64 unitsEntitled, uint64 unitsPaid, bool open, bool closed, uint8 kind, bool reversed, uint64 unitsReversed, uint256 dateIndex)",
  "function settled(bytes32 id, address holder) view returns (bool)",
  "function held(bytes32 id, address holder) view returns (uint256)",
  "error NothingDue(uint256 dateIndex, uint8 kind)",
  "error BeforePaymentDate(uint48 paymentDate)",
  "error AlreadyOpen(bytes32 id)",
  "error NotOpen(bytes32 id)",
  "error AlreadySettled(address holder)",
  "error NotAHolderOfRecord(address holder)",
  "error NothingHeld(address holder)",
  "error CannotReceive(address holder)",
]);
const RECORD_DATES = parseAbi([
  "function balanceAt(address account, uint256 time) view returns (uint256)",
  "function totalSupplyAt(uint256 time) view returns (uint256)",
]);
const PAYING_ROLES = parseAbi(["function FUNDER() view returns (address)", "function INVENTORY() view returns (address)"]);
const CASH = parseAbi([
  "function approve(address spender, uint256 value) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function balanceOf(address account) view returns (uint256)",
]);

/** The two owners of the servicing wallet whose keys the site holds (ADR 0072). */
const SERVICING_OWNERS = ["servicing1", "servicing2"];
/** Holders paid per transaction. */
const BATCH = 40;
const COUPON = 0;
const REDEMPTION = 1;

const now = () => new Date().toISOString();

function context() {
  const m = loadManifest();
  const rpc = process.env.RPC_URL?.trim();
  if (!rpc) throw new Error("RPC_URL is not set");
  const chain = defineChain({ id: m.chainId, name: `chain ${m.chainId}`, nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [rpc] } } });
  return { m, s: signers(chain, rpc) };
}

export type Outcome = { breached: boolean; couponPaid: boolean; couponPerCa: bigint; redeemed: boolean; redemptionPerCa: bigint; worstIndex: number };
export type Payment = { holder: string; units: string; amount: string; tx: string; held?: boolean; claimedTx?: string };
export type EventView = {
  kind: "coupon" | "redemption";
  id: Hex;
  perCaCents: string;
  open: boolean;
  closed: boolean;
  unitsEntitled: string;
  unitsPaid: string;
  payments: Payment[];
};
export type DateView = {
  index: number;
  date: number;
  recordTime: number;
  paymentDate: number;
  tests: { coupon: boolean; mer: boolean; barrier: boolean; isFinal: boolean };
  determined: boolean;
  levels: string[] | null;
  outcome: Outcome | null;
  /** The scenario's Levels for the date, offered to staff before determining. */
  suggested: string[];
  /** After an early redemption, the dates that follow fall away. */
  fallsAway: boolean;
  events: EventView[];
  /** What the independent model expects, on a four-date note; null otherwise. */
  model: { expected: Array<{ kind: string; perCaCents: number }>; matches: boolean | null } | null;
  /** What staff can do now. */
  can: { determine: boolean; pay: Array<"coupon" | "redemption"> };
  /** Why the next step is not yet open, in words. */
  waiting: string | null;
};
export type Lifecycle = { chainNow: number; nextDate: number; terminated: boolean; closed: boolean; dates: DateView[]; initialLevels: number };

const toOutcome = (o: { breached: boolean; couponPaid: boolean; couponPerCa: bigint; redeemed: boolean; redemptionPerCa: bigint; worstIndex: number }): Outcome => ({
  breached: o.breached,
  couponPaid: o.couponPaid,
  couponPerCa: o.couponPerCa,
  redeemed: o.redeemed,
  redemptionPerCa: o.redemptionPerCa,
  worstIndex: o.worstIndex,
});

const at = (t: number) => new Date(t * 1000).toISOString().slice(0, 16).replace("T", " ") + " UTC";

/**
 * Everything the Notes page shows of a note's life, read from the chain: at the latest block, or
 * at block `atBlock`, for a statement as at a moment past (ADR 0094).
 */
export async function lifecycleOf(n: DemoNote, atBlock?: bigint): Promise<Lifecycle> {
  const { s } = context();
  const da = n.addresses.determinations as Address;
  const pa = n.addresses.payingAgent as Address;
  const c = s.publicClient;
  const pin = atBlock === undefined ? {} : { blockNumber: atBlock };
  const [count, next, terminated, block] = await Promise.all([
    c.readContract({ address: da, abi: DETERMINATIONS, functionName: "observationCount", ...pin }),
    c.readContract({ address: da, abi: DETERMINATIONS, functionName: "nextDate", ...pin }),
    c.readContract({ address: da, abi: DETERMINATIONS, functionName: "terminated", ...pin }),
    c.getBlock(pin),
  ]);
  const chainNow = Number(block.timestamp);
  // Payments from the index of the programme's events, as at the block asked for.
  const events = await indexed({ addresses: [pa], names: ["Paid", "Held", "Claimed"], toBlock: atBlock === undefined ? undefined : Number(atBlock), fresh: true });
  const asLog = (e: (typeof events)[number]) => ({ args: e.args as { id?: Hex; holder?: Address; units?: string; amount?: string }, transactionHash: e.tx as Hex });
  const paid = events.filter((e) => e.name === "Paid").map(asLog);
  const held = events.filter((e) => e.name === "Held").map(asLog);
  const claimed = events.filter((e) => e.name === "Claimed").map(asLog);
  const scenario = SCENARIOS.find((x) => x.name === n.scenario);
  const shape = scenario ? stretch(scenario, Number(count)) : null;

  const dates: DateView[] = [];
  for (let k = 0; k < Number(count); k++) {
    const [obs, determined] = await Promise.all([
      c.readContract({ address: da, abi: DETERMINATIONS, functionName: "observation", args: [BigInt(k)], ...pin }),
      c.readContract({ address: da, abi: DETERMINATIONS, functionName: "determined", args: [BigInt(k)], ...pin }),
    ]);
    const [outcome, levels] = determined
      ? await Promise.all([
          c.readContract({ address: da, abi: DETERMINATIONS, functionName: "outcomeOf", args: [BigInt(k)], ...pin }).then(toOutcome),
          c.readContract({ address: da, abi: DETERMINATIONS, functionName: "levelsOf", args: [BigInt(k)], ...pin }),
        ])
      : [null, null];

    const events: EventView[] = [];
    for (const [kind, due] of [["coupon", outcome?.couponPaid], ["redemption", outcome?.redeemed]] as const) {
      if (!due) continue;
      const id = await c.readContract({ address: pa, abi: PAYING, functionName: "idOf", args: [BigInt(k), kind === "coupon" ? COUPON : REDEMPTION] });
      const d = await c.readContract({ address: pa, abi: PAYING, functionName: "distributions", args: [id], ...pin });
      const mine = (l: { args: { id?: Hex } }) => l.args.id?.toLowerCase() === id.toLowerCase();
      const payments: Payment[] = [
        ...paid.filter(mine).map((l) => ({ holder: l.args.holder!, units: String(l.args.units), amount: String(l.args.amount), tx: l.transactionHash })),
        ...held.filter(mine).map((l) => {
          const claim = claimed.find((x) => mine(x) && x.args.holder?.toLowerCase() === l.args.holder?.toLowerCase());
          return { holder: l.args.holder!, units: String(l.args.units), amount: String(l.args.amount), tx: l.transactionHash, held: !claim, claimedTx: claim?.transactionHash };
        }),
      ];
      events.push({
        kind,
        id,
        perCaCents: String(kind === "coupon" ? outcome!.couponPerCa : outcome!.redemptionPerCa),
        open: d[4],
        closed: d[5],
        unitsEntitled: String(d[2]),
        unitsPaid: String(d[3]),
        payments,
      });
    }

    const expected = shape?.expected?.[k] ?? null;
    const matches = expected && outcome
      ? (() => {
          const coupon = expected.find((e) => e.kind === "coupon");
          const redemption = expected.find((e) => e.kind === "mer" || e.kind === "redemption");
          return (
            outcome.couponPaid === Boolean(coupon) &&
            (!coupon || Number(outcome.couponPerCa) === coupon.perCaCents) &&
            outcome.redeemed === Boolean(redemption) &&
            (!redemption || Number(outcome.redemptionPerCa) === redemption.perCaCents)
          );
        })()
      : null;

    const fallsAway = terminated && !determined;
    const dueToDetermine = !terminated && Number(next) === k;
    const pay = events.filter((e) => !e.closed).map((e) => e.kind);
    let waiting: string | null = null;
    if (dueToDetermine && chainNow < obs.date) waiting = `Determinable from ${at(obs.date)}.`;
    else if (pay.length && chainNow < obs.paymentDate) waiting = `Payable from ${at(obs.paymentDate)}.`;
    dates.push({
      index: k,
      date: obs.date,
      recordTime: obs.recordTime,
      paymentDate: obs.paymentDate,
      tests: { coupon: obs.coupon, mer: obs.mer, barrier: obs.barrier, isFinal: obs.isFinal },
      determined,
      levels: levels ? levels.map(String) : null,
      outcome,
      suggested: (shape?.levels[k] ?? []).map(String),
      fallsAway,
      events,
      model: expected ? { expected, matches } : null,
      can: { determine: dueToDetermine && chainNow >= obs.date, pay: chainNow >= obs.paymentDate ? pay : [] },
      waiting,
    });
  }
  const redemption = dates.flatMap((d) => d.events).find((e) => e.kind === "redemption");
  return {
    chainNow,
    nextDate: Number(next),
    terminated,
    closed: Boolean(terminated && redemption?.closed),
    dates,
    initialLevels: scenario?.terms.initialLevels.length ?? 0,
  };
}

async function noteFor(staff: Registrant, noteId: string): Promise<DemoNote> {
  if (!isOperator(staff.email)) throw new Error("Not permitted.");
  const n = await getStore().noteById(noteId);
  if (!n || (n.status !== "issued" && n.status !== "closed")) throw new Error("That note is not issued.");
  return n;
}

/** Records an act of the lifecycle on the note, retried if the note changed meanwhile. */
async function record(noteId: string, change: (d: Record<string, any>) => Record<string, any>, status?: DemoNote["status"]) {
  const store = getStore();
  for (let tries = 0; tries < 5; tries++) {
    const latest = (await store.noteById(noteId))!;
    if (await store.updateNote({ ...latest, ...(status ? { status } : {}), data: change(latest.data as Record<string, any>) }, latest.step)) return;
  }
  throw new Error("The note changed while recording; look again.");
}

/** The checks a determination of date `k` must pass before it is proposed, and again before it is sent. */
async function checkDeterminable(s: ReturnType<typeof signers>, da: Address, k: number, levels: bigint[]) {
  const c = s.publicClient;
  const [next, terminated, obs, block] = await Promise.all([
    c.readContract({ address: da, abi: DETERMINATIONS, functionName: "nextDate" }),
    c.readContract({ address: da, abi: DETERMINATIONS, functionName: "terminated" }),
    c.readContract({ address: da, abi: DETERMINATIONS, functionName: "observation", args: [BigInt(k)] }),
    c.getBlock(),
  ]);
  if (terminated) throw new Error("The note has redeemed: no date remains to determine.");
  if (Number(next) !== k) throw new Error(`Date ${Number(next) + 1} is the next to determine.`);
  if (block.timestamp < BigInt(obs.date)) throw new Error(`Date ${k + 1} is determinable from ${at(obs.date)}.`);
  if (levels.some((l) => l <= 0n)) throw new Error("Every Level is a positive whole number.");
  const [computed] = await c.readContract({ address: da, abi: DETERMINATIONS, functionName: "compute", args: [BigInt(k), levels] }).catch((e) => {
    throw new Error(/InvalidLevels/.test(String(e)) ? "The Levels are refused: give one positive whole-number Level for each underlying." : `The Determination Agent could not compute date ${k + 1}: ${(e as Error).message.split("\n")[0]}`);
  });
  return computed;
}

const said = (o: Outcome) =>
  [o.couponPaid ? `coupon ${o.couponPerCa} cents per Calculation Amount` : "no coupon", o.redeemed ? `redemption at ${o.redemptionPerCa} cents` : null, o.breached ? "barrier breached" : null].filter(Boolean).join(", ");

/**
 * Calculation Agent staff propose determining date `k` from `levels`, with where the Levels came
 * from. It is checked now, and runs once a second person with the same duty approves it, or at once
 * where the deployment's automatic second approver is enabled.
 */
export async function proposeDetermination(staff: Registrant, noteId: string, k: number, levels: bigint[], source = ""): Promise<Job> {
  const n = await noteFor(staff, noteId);
  if (!hasDuty(staff.email, "calculation")) throw new Error("Only Calculation Agent staff determine a date.");
  const { s } = context();
  const computed = toOutcome(await checkDeterminable(s, n.addresses.determinations as Address, k, levels));
  const waiting = (await jobsFor(noteId)).find((j) => j.kind === "determination" && (j.state === "awaiting approval" || j.state === "queued"));
  if (waiting) throw new Error(`Date ${Number(waiting.data.date) + 1}'s determination is already ${waiting.state === "queued" ? "being sent" : "waiting for approval"}.`);
  const job = await createJob("determination", noteId, staff.email, { date: k, levels: levels.map(String), source: source.trim(), outcome: said(computed) });
  await getStore().audit({ at: now(), actor: staff.email, action: `proposed determining date ${k + 1} of ${n.symbol} from Levels ${levels.join(", ")}${source.trim() ? ` (${source.trim()})` : ""}: ${said(computed)}`, subject: n.id });
  return job;
}

/**
 * The approved determination, sent: the Calculation Agent signs the date's Levels and the outcome
 * the contract computes from them, and the contract accepts only that outcome.
 */
export async function determinationStep(job: Job): Promise<StepResult> {
  const n = await getStore().noteById(job.subject);
  if (!n) throw new Error("The note is no longer on record.");
  const k = Number(job.data.date);
  const levels = (job.data.levels as string[]).map((l) => BigInt(l));
  const { s } = context();
  const da = n.addresses.determinations as Address;
  const c = s.publicClient;
  // Sent already, by a run that stopped before recording it.
  if (await c.readContract({ address: da, abi: DETERMINATIONS, functionName: "determined", args: [BigInt(k)] })) return { done: true };
  const computed = await checkDeterminable(s, da, k, levels);
  const digest = await c.readContract({ address: da, abi: DETERMINATIONS, functionName: "digest", args: [BigInt(k), levels, computed] });
  const signature = await s.signHash("calculationAgent", digest);
  const tx = await s.send("calculationAgent", { address: da, abi: DETERMINATIONS, functionName: "determine", args: [BigInt(k), levels, computed, signature] });
  await until(() => c.readContract({ address: da, abi: DETERMINATIONS, functionName: "determined", args: [BigInt(k)] }), Boolean);
  await record(n.id, (d) => ({ ...d, determinations: { ...(d.determinations ?? {}), [k]: { by: job.by, approvedBy: job.approval?.by, at: now(), tx, source: job.data.source } } }));
  await getStore().audit({ at: now(), actor: job.by, action: `determined date ${k + 1} of ${n.symbol}: ${said(toOutcome(computed))}`, subject: n.id });
  return { done: true, data: { tx } };
}

/**
 * Determines date `k` within this request: proposed, and sent at once where the automatic second
 * approver approves it. Otherwise it waits for a second person, and this returns null.
 */
export async function determineDate(staff: Registrant, noteId: string, k: number, levels: bigint[], source = ""): Promise<Hex | null> {
  const job = await proposeDetermination(staff, noteId, k, levels, source);
  if (job.state !== "queued") return null;
  const end = await runToEnd(job.id);
  if (end.state !== "done") throw new Error(end.error ?? `The determination did not finish: ${end.state}.`);
  return (end.data.tx as Hex) ?? null;
}

/** The holders of record at `time`: everyone the note was ever transferred to, with units then. */
async function holdersAt(s: ReturnType<typeof signers>, n: DemoNote, time: number, inventory: Address): Promise<Array<{ holder: Address; units: bigint }>> {
  const transfers = await indexed({ addresses: [n.addresses.note as Address], names: ["Transfer"], fresh: true });
  const candidates = [...new Set(transfers.map((l) => String(l.args.to).toLowerCase()))].filter((a) => a !== inventory.toLowerCase() && a !== "0x0000000000000000000000000000000000000000");
  const units = await Promise.all(
    candidates.map((h) => s.publicClient.readContract({ address: n.addresses.recordDates as Address, abi: RECORD_DATES, functionName: "balanceAt", args: [h as Address, BigInt(time)] })),
  );
  return candidates.map((h, i) => ({ holder: h as Address, units: units[i] })).filter((x) => x.units > 0n);
}

/**
 * Staff start paying date `k`'s coupon or redemption: a background job the server carries to its end
 * (ADR 0116). Refused at once where nothing is due, it is early, it is paid, or a run is under way.
 */
export async function startPayment(staff: Registrant, noteId: string, k: number, kind: "coupon" | "redemption"): Promise<Job> {
  const n = await noteFor(staff, noteId);
  if (!hasDuty(staff.email, "payments")) throw new Error("Only payments staff pay a coupon or a redemption.");
  const view = await lifecycleOf(n);
  const date = view.dates[k];
  const event = date?.events.find((e) => e.kind === kind);
  if (!event) throw new Error(`Date ${k + 1} has no ${kind} due.`);
  if (view.chainNow < date.paymentDate) throw new Error(`Date ${k + 1} is payable from ${at(date.paymentDate)}.`);
  if (event.closed) throw new Error(`Date ${k + 1}'s ${kind} is already paid.`);
  const running = (await jobsFor(noteId)).find((j) => j.kind === "payment" && (j.state === "queued" || j.state === "awaiting approval") && j.data.date === k && j.data.event === kind);
  if (running) throw new Error(`Date ${k + 1}'s ${kind} is already ${running.state === "queued" ? "being paid" : "waiting for approval"}.`);
  const job = await createJob("payment", noteId, staff.email, { date: k, event: kind, txs: [] });
  await getStore().audit({ at: now(), actor: staff.email, action: `started paying date ${k + 1}'s ${kind} of ${n.symbol}`, subject: n.id });
  return job;
}

/**
 * One step of a payment run, the next the chain's state calls for:
 *
 * 1. The funder approves the Paying Agent for exactly what opening the event draws: the amount per
 *    Calculation Amount times the units entitled at the Record Time, every unit outside the Issuer's
 *    inventory.
 * 2. The servicing wallet opens the event.
 * 3. For a redemption, which pauses the note, offers still locking units are released, as anyone
 *    may once it is paused, so the units can be burned.
 * 4. The servicing wallet pays the holders of record not yet paid, a batch per step, until the event
 *    closes; then the note records it.
 */
export async function paymentStep(job: Job): Promise<StepResult> {
  const n = await getStore().noteById(job.subject);
  if (!n) throw new Error("The note is no longer on record.");
  const k = Number(job.data.date);
  const kind = job.data.event as "coupon" | "redemption";
  const txs = [...((job.data.txs as Hex[]) ?? [])];
  const { m, s } = context();
  const wallet = m.governance?.servicingWallet as Address | undefined;
  if (!wallet) throw new Error("The deployment has no servicing wallet.");
  const pa = n.addresses.payingAgent as Address;
  const c = s.publicClient;
  const code = kind === "coupon" ? COUPON : REDEMPTION;
  const id = await c.readContract({ address: pa, abi: PAYING, functionName: "idOf", args: [BigInt(k), code] });
  const through = (data: Hex) => execThroughWallet(s, wallet, SERVICING_OWNERS, "agent", pa, data);
  const da = n.addresses.determinations as Address;
  // Only this date: its calendar and its outcome, not the whole note's life.
  const [d, obs, outcome] = await Promise.all([
    c.readContract({ address: pa, abi: PAYING, functionName: "distributions", args: [id] }),
    c.readContract({ address: da, abi: DETERMINATIONS, functionName: "observation", args: [BigInt(k)] }),
    c.readContract({ address: da, abi: DETERMINATIONS, functionName: "outcomeOf", args: [BigInt(k)] }).then(toOutcome),
  ]);
  const date = { recordTime: Number(obs.recordTime), paymentDate: Number(obs.paymentDate), outcome };

  if (d[5]) {
    // Closed: recorded on the note, once.
    const closesNote = kind === "redemption";
    await record(n.id, (x) => ({ ...x, payments: { ...(x.payments ?? {}), [`${k}/${kind}`]: { by: job.by, at: now(), txs } } }), closesNote ? "closed" : undefined);
    await getStore().audit({
      at: now(),
      actor: job.by,
      action: `the servicing wallet paid date ${k + 1}'s ${kind} of ${n.symbol}: ${d[3]} units at ${d[1]} cents per Calculation Amount${closesNote ? "; the note is redeemed and closed" : ""}`,
      subject: n.id,
    });
    return { done: true, data: { txs } };
  }

  if (!d[4]) {
    const [funder, inventory] = await Promise.all([
      c.readContract({ address: pa, abi: PAYING_ROLES, functionName: "FUNDER" }),
      c.readContract({ address: pa, abi: PAYING_ROLES, functionName: "INVENTORY" }),
    ]);
    const [supply, kept] = await Promise.all([
      c.readContract({ address: n.addresses.recordDates as Address, abi: RECORD_DATES, functionName: "totalSupplyAt", args: [BigInt(date.recordTime)] }),
      c.readContract({ address: n.addresses.recordDates as Address, abi: RECORD_DATES, functionName: "balanceAt", args: [inventory, BigInt(date.recordTime)] }),
    ]);
    const outcome = date.outcome!;
    const amount = (kind === "coupon" ? outcome.couponPerCa : outcome.redemptionPerCa) * (supply - kept);
    if (funder.toLowerCase() !== s.address("agent").toLowerCase()) throw new Error(`The funder of distributions is ${funder}, whose key the site does not hold.`);
    const deposit = m.assets.deposit!.address as Address;
    const allowance = await c.readContract({ address: deposit, abi: CASH, functionName: "allowance", args: [funder, pa] });
    if (amount > 0n && allowance < amount) {
      const held = await c.readContract({ address: deposit, abi: CASH, functionName: "balanceOf", args: [funder] });
      if (held < amount) throw new Error(`The Agent holds ${held} cents of the deposit; date ${k + 1}'s ${kind} needs ${amount}. The bank credits the Agent first.`);
      txs.push(await s.send("agent", { address: deposit, abi: CASH, functionName: "approve", args: [pa, amount] }));
      await until(() => c.readContract({ address: deposit, abi: CASH, functionName: "allowance", args: [funder, pa] }), (a) => a >= amount);
      return { done: false, data: { txs, step: "approved" } };
    }
    txs.push(await through(encodeFunctionData({ abi: PAYING, functionName: "open", args: [BigInt(k), code] })));
    await until(() => c.readContract({ address: pa, abi: PAYING, functionName: "distributions", args: [id] }), (x) => x[4]);
    return { done: false, data: { txs, step: "opened" } };
  }

  if (kind === "redemption" && !job.data.released) {
    await releaseOpenOffers(n.id, true);
    return { done: false, data: { txs, released: true, step: "offers released" } };
  }

  const holders = await holdersAt(s, n, date.recordTime, s.address("issuer"));
  const settled = await Promise.all(holders.map((h) => c.readContract({ address: pa, abi: PAYING, functionName: "settled", args: [id, h.holder] })));
  const due = holders.filter((_, i) => !settled[i]).map((h) => h.holder);
  if (!due.length) {
    const closed = await until(() => c.readContract({ address: pa, abi: PAYING, functionName: "distributions", args: [id] }), (x) => x[5]);
    if (!closed[5]) throw new Error(`Paid ${closed[3]} of ${closed[2]} units entitled; the event is not closed. A holder of record is missing from the note's transfers.`);
    return { done: false, data: { txs } };
  }
  txs.push(await through(encodeFunctionData({ abi: PAYING, functionName: "pay", args: [id, due.slice(0, BATCH)] })));
  await until(() => c.readContract({ address: pa, abi: PAYING, functionName: "settled", args: [id, due[0]] }), Boolean);
  return { done: false, data: { txs, step: `paid ${Math.min(BATCH, due.length)} of ${due.length} holders still due` } };
}

/**
 * Pays date `k`'s coupon or redemption to the end within this request: the same job, run here, for
 * scripts and tests that wait for it. Returns the transactions sent.
 */
export async function payEvent(staff: Registrant, noteId: string, k: number, kind: "coupon" | "redemption"): Promise<Hex[]> {
  const job = await startPayment(staff, noteId, k, kind);
  if (job.state !== "queued") return [];
  const end = await runToEnd(job.id);
  if (end.state !== "done") throw new Error(end.error ?? `The payment did not finish: ${end.state}.`);
  return (end.data.txs as Hex[]) ?? [];
}

/** Pays an amount held for a holder the deposit could not credit, once it can (anyone may). */
export async function claimHeld(staff: Registrant, noteId: string, id: Hex, holder: Address): Promise<Hex> {
  const n = await noteFor(staff, noteId);
  const { s } = context();
  const pa = n.addresses.payingAgent as Address;
  const amount = await s.publicClient.readContract({ address: pa, abi: PAYING, functionName: "held", args: [id, holder] });
  if (amount === 0n) throw new Error("Nothing is held for that holder.");
  const tx = await s.send("agent", { address: pa, abi: PAYING, functionName: "claim", args: [id, holder] }).catch((e) => {
    throw new Error(/CannotReceive/.test(String(e)) ? `${holder} cannot yet receive the deposit: its grant must be live again.` : (e as Error).message);
  });
  await getStore().audit({ at: now(), actor: staff.email, action: `paid ${amount} cents held for ${holder} on ${n.symbol}`, subject: n.id });
  return tx;
}

/** The coupons and redemptions an account has been paid, across every note. */
export async function paymentsTo(account: Address): Promise<Array<{ note: DemoNote; date: number; kind: "coupon" | "redemption"; units: string; amount: string; held: boolean; tx: string }>> {
  const notes = (await getStore().listNotes()).filter((n) => n.addresses.payingAgent && (n.status === "issued" || n.status === "closed"));
  const out: Array<{ note: DemoNote; date: number; kind: "coupon" | "redemption"; units: string; amount: string; held: boolean; tx: string }> = [];
  for (const n of notes) {
    const view = await lifecycleOf(n).catch(() => null);
    for (const d of view?.dates ?? []) {
      for (const e of d.events) {
        for (const p of e.payments.filter((x) => x.holder.toLowerCase() === account.toLowerCase())) {
          out.push({ note: n, date: d.index, kind: e.kind, units: p.units, amount: p.amount, held: Boolean(p.held), tx: p.claimedTx ?? p.tx });
        }
      }
    }
  }
  return out;
}
