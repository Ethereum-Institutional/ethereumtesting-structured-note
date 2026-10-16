import "server-only";
import { randomBytes } from "node:crypto";
import { defineChain, keccak256, maxUint256, parseAbi, parseEventLogs, toBytes, type Address, type Hex } from "viem";
import { loadManifest, type Manifest } from "../chain/manifest.ts";
import { signers } from "../chain/signer.ts";
import { getStore, type DemoNote, type Registrant } from "../store.ts";
import { hasRole } from "../operators.ts";
import scenarios from "./scenarios.json" with { type: "json" };
import { calendar as calendarOf, calendarProblem, stretch, type Interval } from "./calendar.ts";
import { termSheetFrom, toTerms } from "./termsheet.ts";
import { keepTermSheet, termSheetOfNote, termSheetUri } from "./termsheets.ts";

/**
 * Issuing a note (ADRs 0072, 0073, 0091): the same contracts as the note under review, a scenario's
 * terms, and a calendar staff choose at issuance. The Issuer issues the note whole through the note
 * factory, in one transaction: its terms, record dates, T-REX suite on the deployment's identity
 * storage, term sheet, Paying Agent and settlement contract, each agent restricted to its own
 * powers (ADR 0085), the notional minted to the Issuer's inventory, and the note opened. The bank
 * and the Agent then do their own parts. Each step is recorded as it lands, so the page that starts
 * it can follow it to the end and a failed step can be run again.
 *
 * Roles follow the issuance script: the factory owns the note for the Issuer, which mints into its
 * inventory and holds it; the Agent funds and may cancel units from the inventory; the Calculation
 * Agent determines; the Agent's servicing wallet pays.
 */
export type Scenario = (typeof scenarios)[number];
export const SCENARIOS: Scenario[] = scenarios;

const NOTE = parseAbi([
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function onchainID() view returns (address)",
]);
const RESTRICTIONS = "(bool disableMint, bool disableBurn, bool disablePartialFreeze, bool disableAddressFreeze, bool disableRecovery, bool disableForceTransfer, bool disablePause)";
// As IDeterminationAgent declares them, field for field.
const OBSERVATION = "(uint48 date, uint48 recordTime, uint48 paymentDate, bool coupon, bool mer, bool barrier, bool isFinal, uint32 merTriggerBps)";
const TERMS = `(uint256[] initialLevels, uint64 calculationAmountCents, uint32 couponBarrierBps, uint32 couponRateBps, bool memory_, uint32 barrierBps, (bool applies, uint32 upBps, uint32 downBps, uint32 capBps) twinWin, ${OBSERVATION}[] schedule)`;
const NOTE_RECORD = "(address token, address identity, address identityRegistry, address compliance, address trustedIssuers, address claimTopics, address determinations, address recordDates, address payingAgent, address settlement)";
const FACTORY = parseAbi([
  `function issue((string salt, string name, string symbol, ${TERMS} terms, address issuer, address calculationAgent, address funder, address payer, bytes32 termSheetHash, string termSheetUri, uint256 units, bool open, (address agent, ${RESTRICTIONS} restrictions)[] agents) p) returns (${NOTE_RECORD})`,
  `event NoteIssued(address indexed token, string salt, ${NOTE_RECORD} note)`,
]);
const DEPOSIT = parseAbi([
  "function setAllowlistedMany(address[] accounts, bool allowed)",
  "function approve(address spender, uint256 value) returns (bool)",
]);
const GATEWAY = parseAbi(["function credit(address account, uint256 amount, bytes32 bookingRef)"]);

/** Burning alone: the Agent cancels units from the Issuer's inventory (ADR 0085). */
const BURN_ONLY = { disableMint: true, disableBurn: false, disablePartialFreeze: true, disableAddressFreeze: true, disableRecovery: true, disableForceTransfer: true, disablePause: true };

const now = () => new Date().toISOString();

function context() {
  const m = loadManifest();
  const rpc = process.env.RPC_URL?.trim();
  if (!rpc) throw new Error("RPC_URL is not set");
  if (!m.identity?.noteFactory) throw new Error("the manifest has no note factory: deploy 0.2.0");
  const chain = defineChain({ id: m.chainId, name: `chain ${m.chainId}`, nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [rpc] } } });
  return { m, id: m.identity, factory: m.identity.noteFactory as Address, s: signers(chain, rpc) };
}

/** The note's observations and the time between them; notes issued before ADR 0073 had four, minutes apart. */
const shapeOf = (n: DemoNote): { observations: number; interval: Interval } =>
  n.interval && n.observations ? { observations: n.observations, interval: n.interval } : { observations: 4, interval: { value: n.spacingMinutes ?? 10, unit: "minutes" } };

type Ctx = ReturnType<typeof context> & { n: DemoNote; scenario: Scenario };
type Step = { label: string; run: (c: Ctx) => Promise<Partial<DemoNote> | void> };

/** What the site records of an issued note: its contracts, calendar, term sheet and transaction. */
function issuedPatch(
  c: Ctx,
  n: { token: Address; identity: Address; identityRegistry: Address; compliance: Address; determinations: Address; recordDates: Address; payingAgent: Address; settlement: Address },
  hash: Hex,
  calendar: Array<{ date: number; recordTime: number; paymentDate: number }>,
  sheetHash: Hex | undefined,
): Partial<DemoNote> {
  return {
    calendar,
    addresses: {
      ...c.n.addresses,
      note: n.token,
      noteIdentity: n.identity,
      identityRegistry: n.identityRegistry,
      compliance: n.compliance,
      determinations: n.determinations,
      recordDates: n.recordDates,
      payingAgent: n.payingAgent,
      settlement: n.settlement,
    },
    data: { ...c.n.data, settlement: "locked", ...(sheetHash ? { termSheet: sheetHash } : {}) },
    txs: { ...c.n.txs, note: hash, settlement: hash },
  } as Partial<DemoNote>;
}

const tx = (key: string, hash: Hex) => (n: DemoNote) => ({ txs: { ...n.txs, [key]: hash } });

const SCHEDULE = parseAbi([`function terms() view returns (${TERMS} t)`]);

/**
 * A note this series already issued, found by its salt in the factory's events (ADR 0103). The
 * issuance can land after the site stopped waiting for it; run again, the step then picks the note
 * up rather than issuing a second, which the factory would refuse.
 */
async function issuedEarlier(c: Ctx) {
  const head = await c.s.publicClient.getBlockNumber();
  const ageBlocks = BigInt(Math.ceil((Date.now() - Date.parse(c.n.createdAt)) / 1000 / 2) + 600); // block times of 2 s or more
  const fromBlock = head > ageBlocks ? head - ageBlocks : 0n;
  const logs = await c.s.publicClient.getLogs({ address: c.factory, event: FACTORY.find((x) => x.type === "event" && x.name === "NoteIssued") as any, fromBlock, toBlock: head });
  const found = (logs as any[]).find((l) => l.args?.salt === c.n.id);
  return found ? { hash: found.transactionHash as Hex, block: found.blockNumber as bigint, note: found.args.note as { token: Address; identity: Address; identityRegistry: Address; compliance: Address; determinations: Address; recordDates: Address; payingAgent: Address; settlement: Address } } : null;
}

/** The issuance: the Issuer's one transaction, then the bank's two and the Agent's one. */
const STEPS: Step[] = [
  {
    label: "Issue the note through the factory: terms, T-REX suite, term sheet, Paying Agent, settlement, agents, notional, open (Issuer, one transaction)",
    run: async (c) => {
      const earlier = await issuedEarlier(c);
      if (earlier) {
        // Its own calendar and term sheet, read back from the chain, not made afresh.
        // Read at the block that reported it, which every RPC that returned the event has seen.
        const t = (await c.s.publicClient.readContract({ address: earlier.note.determinations, abi: SCHEDULE, functionName: "terms", blockNumber: earlier.block })) as any;
        const sheet = await termSheetOfNote(earlier.note.token, earlier.note.determinations, earlier.block);
        return issuedPatch(c, earlier.note, earlier.hash, t.schedule.map((o: any) => ({ date: Number(o.date), recordTime: Number(o.recordTime), paymentDate: Number(o.paymentDate) })), sheet?.hash);
      }
      const payer = c.m.governance?.servicingWallet;
      if (!payer) throw new Error("the deployment has no servicing wallet");
      const block = await c.s.publicClient.getBlock();
      const shape = shapeOf(c.n);
      const calendar = calendarOf(Number(block.timestamp), shape.observations, shape.interval);
      const stretched = stretch(c.scenario, shape.observations);
      const t = c.scenario.terms;
      // The term sheet first: the record this series is issued from, kept and published by its hash (ADR 0095).
      const record = termSheetFrom({
        name: c.n.name,
        symbol: c.n.symbol,
        chainId: c.m.chainId,
        issueSizeUnits: c.n.units,
        strikeTime: Number(block.timestamp),
        initialLevels: t.initialLevels,
        calculationAmountCents: t.calculationAmountCents,
        couponBarrierBps: t.couponBarrierBps,
        couponRateBps: t.couponRateBps,
        memory: t.memory,
        barrierBps: t.barrierBps,
        twinWin: t.twinWin,
        schedule: stretched.schedule.map((o, k) => ({ date: calendar[k].date, recordTime: calendar[k].recordTime, paymentDate: calendar[k].paymentDate, coupon: o.coupon, mer: o.mer, barrier: o.barrier, isFinal: o.isFinal, merTriggerBps: o.merTriggerBps })),
        depositSymbol: c.m.assets.deposit!.symbol,
      });
      const sheetHash = await keepTermSheet(record);
      const terms = toTerms(record);
      const params = {
        salt: c.n.id,
        name: c.n.name,
        symbol: c.n.symbol,
        terms,
        issuer: c.s.address("issuer"),
        calculationAgent: c.s.address("calculationAgent"),
        funder: c.s.address("agent"),
        payer,
        termSheetHash: sheetHash,
        termSheetUri: termSheetUri(sheetHash),
        units: BigInt(c.n.units),
        open: true,
        agents: [{ agent: c.s.address("agent"), restrictions: BURN_ONLY }],
      };
      const hash = await c.s.send("issuer", { address: c.factory, abi: FACTORY, functionName: "issue", args: [params] });
      const receipt = await c.s.publicClient.waitForTransactionReceipt({ hash });
      const [issued] = parseEventLogs({ abi: FACTORY, eventName: "NoteIssued", logs: receipt.logs });
      if (receipt.status !== "success" || !issued) throw new Error(`the issuance reverted (${hash})`);
      return issuedPatch(c, issued.args.note, hash, calendar, sheetHash);
    },
  },
  {
    label: "The bank allowlists the Paying Agent and the settlement contract for its deposit",
    run: async (c) =>
      tx("allowlist", await c.s.send("depositAgent", { address: c.m.assets.deposit!.address, abi: DEPOSIT, functionName: "setAllowlistedMany", args: [[c.n.addresses.payingAgent, c.n.addresses.settlement], true] }))(c.n),
  },
  {
    label: "The bank funds the Agent for coupons and redemptions",
    run: async (c) => {
      // Enough to pay every coupon and redeem at the most the scenario can pay: twice the Calculation Amount per unit.
      const amount = BigInt(c.n.units) * BigInt(c.scenario.terms.calculationAmountCents) * 2n;
      const h = await c.s.send("depositAgent", { address: c.m.instruments!.gateway, abi: GATEWAY, functionName: "credit", args: [c.s.address("agent"), amount, keccak256(toBytes(`${c.n.symbol}/funding/${randomBytes(4).toString("hex")}`))] });
      return tx("funding", h)(c.n);
    },
  },
  {
    label: "The Agent lets the Paying Agent draw its funds",
    run: async (c) => tx("allowance", await c.s.send("agent", { address: c.m.assets.deposit!.address, abi: DEPOSIT, functionName: "approve", args: [c.n.addresses.payingAgent, maxUint256] }))(c.n),
  },
];

export const ISSUANCE_STEPS = STEPS.map((s) => s.label);

/** Starts a note; the first step runs at once, the rest as the page asks. */
export async function startNote(staff: Registrant, input: { scenario: string; observations: number; interval: Interval; units: number }): Promise<DemoNote> {
  if (!hasRole(staff.email, "agent")) throw new Error("Not permitted.");
  const scenario = SCENARIOS.find((s) => s.name === input.scenario);
  if (!scenario) throw new Error("Choose a scenario.");
  const problem = calendarProblem(input.observations, input.interval);
  if (problem) throw new Error(problem);
  if (!Number.isInteger(input.units) || input.units < 1 || input.units > 100) throw new Error("Issue between 1 and 100 units.");
  const store = getStore();
  const m: Manifest = loadManifest();
  const live = { name: await readLive(m, "name"), symbol: await readLive(m, "symbol") };
  const series = (await store.listNotes()).length + 2; // the live note is series 1
  const n: DemoNote = {
    id: `note_${randomBytes(9).toString("base64url")}`,
    series,
    name: `${live.name}, Series ${series}`,
    symbol: `${live.symbol}${series}`,
    scenario: scenario.name,
    observations: input.observations,
    interval: input.interval,
    units: input.units,
    status: "issuing",
    step: 0,
    createdAt: now(),
    by: staff.email,
    addresses: {},
    txs: {},
    data: {},
  };
  await store.putNote(n);
  await store.audit({ at: now(), actor: staff.email, action: `started issuing ${n.name} (${n.symbol}), scenario ${scenario.name}, ${n.units} units, ${input.observations} observations every ${input.interval.value} ${input.interval.unit}`, subject: n.id });
  return n;
}

async function readLive(m: Manifest, functionName: "name" | "symbol"): Promise<string> {
  const { s } = context();
  return s.publicClient.readContract({ address: m.assets.note!.address as Address, abi: NOTE, functionName });
}

/** Longer than a page may run (maxDuration, 300 s): a claim this old belongs to a request that was stopped. */
const CLAIM_TTL_MS = 6 * 60_000;

/** Beyond every step: an issuance stopped by staff, so that a step still in flight cannot record itself after. */
const STOPPED_STEP = 1_000;

/** Staff stop an issuance that will not finish (ADR 0105). Whatever already landed on the chain stays. */
export async function stopIssuance(staff: Registrant, id: string): Promise<void> {
  if (!hasRole(staff.email, "agent")) throw new Error("Not permitted.");
  const store = getStore();
  const n = await store.noteById(id);
  if (!n || n.status !== "issuing") throw new Error("This note is not being issued.");
  const stopped = { ...n, status: "failed" as const, step: STOPPED_STEP, claimedAt: undefined, error: `Stopped by ${staff.email} at step ${Math.abs(n.step) + (n.step < 0 ? 0 : 1)}` };
  if (!(await store.updateNote(stopped, n.step))) throw new Error("The issuance moved on meanwhile; try again.");
  await store.audit({ at: now(), actor: staff.email, action: `stopped issuing ${n.name} at step ${Math.abs(n.step) + (n.step < 0 ? 0 : 1)}`, subject: n.id });
}

/**
 * Runs the note's next issuance step. Safe to call repeatedly: the step is claimed in the store
 * before it is sent, so two callers cannot both run it; a failed step leaves the note to be retried.
 */
export async function advanceIssuance(id: string): Promise<DemoNote | null> {
  const store = getStore();
  let n = await store.noteById(id);
  if (!n || n.status !== "issuing") return n;
  // A step in flight (ADR 0105). The page polls every few seconds while a step on Ethereum Sepolia
  // can take minutes: leave it be, unless its claim is older than any page may run, in which case
  // the request running it was stopped, and the step is released to run again.
  if (n.step < 0) {
    const claimed = n.claimedAt ? Date.parse(n.claimedAt) : 0;
    if (Date.now() - claimed < CLAIM_TTL_MS) return n;
    const released = { ...n, step: -n.step - 1, claimedAt: undefined, error: "The step did not finish in time, and runs again" };
    if (!(await store.updateNote(released, n.step))) return store.noteById(id);
    n = released;
  }
  const step = STEPS[n.step];
  if (!step) {
    const done = { ...n, status: "issued" as const };
    await store.updateNote(done, n.step);
    return done;
  }
  // Claim the step: a negative step marks it in flight, so a second caller does nothing.
  const claimed = { ...n, step: -(n.step + 1), claimedAt: now(), error: undefined };
  if (!(await store.updateNote(claimed, n.step))) return n;
  const scenario = SCENARIOS.find((s) => s.name === n.scenario)!;
  try {
    const patch = (await step.run({ ...context(), n, scenario })) ?? {};
    const next = { ...n, ...patch, step: n.step + 1, claimedAt: undefined, error: undefined } as DemoNote;
    if (!STEPS[next.step]) next.status = "issued";
    await store.updateNote(next, claimed.step);
    if (next.status === "issued") await store.audit({ at: now(), actor: "site", action: `issued ${n.name}: ${n.units} units to the Issuer's inventory`, subject: n.id });
    return next;
  } catch (e) {
    // Left at the same step with its error, to run again on the next call. A step whose simulation
    // failed sent nothing; the commonest cause is a lagging RPC that has not yet seen the step before.
    const failed = { ...n, error: `${step.label}: ${(e as Error).message.split("\n")[0]}` };
    await store.updateNote(failed, claimed.step);
    return failed;
  }
}
