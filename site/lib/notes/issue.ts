import "server-only";
import { randomBytes } from "node:crypto";
import { defineChain, encodeFunctionData, keccak256, parseAbi, parseEventLogs, toBytes, type Address, type Hex } from "viem";
import { loadManifest, type Manifest } from "../chain/manifest.ts";
import { signers } from "../chain/signer.ts";
import { execThroughWallet } from "../chain/safe.ts";
import { getStore, type DemoNote, type Registrant } from "../store.ts";
import { hasRole } from "../operators.ts";
import scenarios from "./scenarios.json" with { type: "json" };
import { calendar as calendarOf, calendarProblem, stretch, type Interval } from "./calendar.ts";
import { SCHEMA, termSheetFrom, toTerms, v, validate, value, isNA, type Item, type TermSheet } from "./termsheet.ts";
import { keepTermSheet, termSheetByHash, termSheetOfNote, termSheetUri } from "./termsheets.ts";

/**
 * Issuing a note: the same contracts as the deployment's own note, a scenario's terms, and a
 * calendar staff choose at issuance. The Issuer's governance wallet issues the note whole through
 * the note factory, in one transaction: its terms and record dates, its T-REX suite on the
 * deployment's identity storage, its term sheet and series claims, its Paying Agent and settlement
 * contract, each allowlisted on the deposit, the notional minted to the Issuer's inventory, and the
 * note opened and handed to the governance controller. The bank then funds the Agent. Each step is
 * recorded as it lands, so the page that starts it can follow it to the end and a failed step can
 * be run again.
 *
 * Roles are the programme's, not the note's: the controller holds the note's agent powers; the
 * Calculation Agent determines; the servicing wallet pays; the Agent funds each distribution, by an
 * approval of exactly its amount when it opens.
 */
export type Scenario = (typeof scenarios)[number];
export const SCENARIOS: Scenario[] = scenarios;

const NOTE = parseAbi([
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function onchainID() view returns (address)",
]);
// As IDeterminationAgent declares them, field for field.
const OBSERVATION = "(uint48 date, uint48 recordTime, uint48 paymentDate, bool coupon, bool mer, bool barrier, bool isFinal, uint32 merTriggerBps)";
const TERMS = `(uint256[] initialLevels, uint64 calculationAmountCents, uint32 couponBarrierBps, uint32 couponRateBps, bool memory_, uint32 barrierBps, (bool applies, uint32 upBps, uint32 downBps, uint32 capBps) twinWin, ${OBSERVATION}[] schedule)`;
export const NOTE_RECORD = "(uint256 series, address token, address identity, address identityRegistry, address compliance, address trustedIssuers, address claimTopics, address determinations, address recordDates, address payingAgent, address settlement, address inventory)";
export const FACTORY = parseAbi([
  `function issue((string isin, string name, string symbol, ${TERMS} terms, address issuer, bytes32 termSheetHash, string termSheetUri, uint256 units, bool open, uint256[] extraTopics, address[] extraIssuers) p) returns (${NOTE_RECORD})`,
  `event NoteIssued(address indexed token, uint256 indexed series, string isin, ${NOTE_RECORD} note)`,
  "function seriesCount() view returns (uint256)",
  "error InvalidArgument()",
]);
const GATEWAY = parseAbi(["function credit(address account, uint256 amount, bytes32 bookingRef)"]);

/** The two owners of the Issuer's governance wallet whose keys the site holds. */
const ISSUER_OWNERS = ["issuerGov1", "issuerGov2"];

const now = () => new Date().toISOString();

function context() {
  const m = loadManifest();
  const rpc = process.env.RPC_URL?.trim();
  if (!rpc) throw new Error("RPC_URL is not set");
  if (!m.identity?.noteFactory) throw new Error("The deployment has no note factory.");
  const chain = defineChain({ id: m.chainId, name: `chain ${m.chainId}`, nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [rpc] } } });
  return { m, id: m.identity, factory: m.identity.noteFactory as Address, s: signers(chain, rpc) };
}

/** The note's observations and the time between them; notes issued before had four, minutes apart. */
const shapeOf = (n: DemoNote): { observations: number; interval: Interval } =>
  n.interval && n.observations ? { observations: n.observations, interval: n.interval } : { observations: 4, interval: { value: n.spacingMinutes ?? 10, unit: "minutes" } };

/** A note issued from a scenario has one; a note issued from an uploaded term sheet has none. */
type Ctx = ReturnType<typeof context> & { n: DemoNote; scenario: Scenario | undefined };
type Step = { label: string; run: (c: Ctx) => Promise<Partial<DemoNote> | void> };

/** What the site records of an issued note: its contracts, calendar, term sheet and transaction. */
function issuedPatch(
  c: Ctx,
  n: IssuedNote,
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
    data: { ...c.n.data, settlement: "locked", series: Number(n.series), ...(sheetHash ? { termSheet: sheetHash } : {}) },
    txs: { ...c.n.txs, note: hash, settlement: hash },
  } as Partial<DemoNote>;
}

type IssuedNote = { series: bigint; token: Address; identity: Address; identityRegistry: Address; compliance: Address; determinations: Address; recordDates: Address; payingAgent: Address; settlement: Address };

const tx = (key: string, hash: Hex) => (n: DemoNote) => ({ txs: { ...n.txs, [key]: hash } });

const SCHEDULE = parseAbi([`function terms() view returns (${TERMS} t)`]);

/**
 * A note this issuance already made, found by its name and symbol among the factory's events since
 * it started. The issuance can land after the site stopped waiting for it; run again, the step then
 * picks the note up rather than issuing a second.
 */
async function issuedEarlier(c: Ctx) {
  const head = await c.s.publicClient.getBlockNumber();
  const ageBlocks = BigInt(Math.ceil((Date.now() - Date.parse(c.n.createdAt)) / 1000 / 2) + 600); // block times of 2 s or more
  const fromBlock = head > ageBlocks ? head - ageBlocks : 0n;
  const event = FACTORY.find((x) => x.type === "event" && x.name === "NoteIssued") as any;
  const logs = (await c.s.publicClient.getLogs({ address: c.factory, event, fromBlock, toBlock: head })) as any[];
  for (const l of logs.reverse()) {
    const token = l.args.token as Address;
    // A name and symbol never change. Read at the event's block, which every RPC that returned the
    // event has seen; where the node keeps no state that old, at the latest.
    const read = (functionName: "name" | "symbol") =>
      c.s.publicClient.readContract({ address: token, abi: NOTE, functionName, blockNumber: l.blockNumber }).catch(() => c.s.publicClient.readContract({ address: token, abi: NOTE, functionName }));
    const [name, symbol] = await Promise.all([read("name"), read("symbol")]);
    if (name === c.n.name && symbol === c.n.symbol) return { hash: l.transactionHash as Hex, block: l.blockNumber as bigint, note: l.args.note as IssuedNote };
  }
  return null;
}

/** The issuance: the Issuer's wallet's one transaction, then the bank's credit to the Agent. */
const STEPS: Step[] = [
  {
    label: "Issue the note through the factory: terms, T-REX suite, term sheet, Paying Agent, settlement, notional, open, governed (the Issuer's wallet, one transaction)",
    run: async (c) => {
      const earlier = await issuedEarlier(c);
      if (earlier) {
        // Its own calendar and term sheet, read back from the chain, not made afresh.
        // Read at the block that reported it, which every RPC that returned the event has seen.
        const t = (await c.s.publicClient.readContract({ address: earlier.note.determinations, abi: SCHEDULE, functionName: "terms", blockNumber: earlier.block })) as any;
        const sheet = await termSheetOfNote(earlier.note.token, earlier.note.determinations, earlier.block);
        return issuedPatch(c, earlier.note, earlier.hash, t.schedule.map((o: any) => ({ date: Number(o.date), recordTime: Number(o.recordTime), paymentDate: Number(o.paymentDate) })), sheet?.hash);
      }
      const issuerWallet = c.m.governance?.issuerGovernance;
      if (!issuerWallet) throw new Error("The deployment has no Issuer's wallet.");
      const block = await c.s.publicClient.getBlock();
      let record: TermSheet;
      let calendar: Array<{ date: number; recordTime: number; paymentDate: number }>;
      const uploaded = c.n.data.termSheet as string | undefined;
      if (uploaded) {
        // Issued from a term sheet staff uploaded: the record as it stands, its dates its own.
        const kept = await termSheetByHash(uploaded);
        if (!kept) throw new Error("The term sheet this note is issued from is no longer on record.");
        record = kept;
        calendar = (value<Item[]>(record.fields.calendar) ?? []).map((o) => ({ date: Number(value(o.date)), recordTime: Number(value(o.recordTime)), paymentDate: Number(value(o.paymentDate)) }));
        if (calendar[0].recordTime <= Number(block.timestamp)) throw new Error(`The term sheet's first Record Time, ${new Date(calendar[0].recordTime * 1000).toISOString()}, has passed: issue it with later dates.`);
      } else {
        const shape = shapeOf(c.n);
        calendar = calendarOf(Number(block.timestamp), shape.observations, shape.interval);
        const stretched = stretch(c.scenario!, shape.observations);
        const t = c.scenario!.terms;
        // The term sheet first: the record this series is issued from, kept and published by its hash.
        record = termSheetFrom({
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
        if (c.n.isin) record.fields.isin = v(c.n.isin);
      }
      const sheetHash = await keepTermSheet(record);
      const terms = toTerms(record);
      const params = {
        isin: c.n.isin ?? "",
        name: c.n.name,
        symbol: c.n.symbol,
        terms,
        issuer: c.s.address("issuer"),
        termSheetHash: sheetHash,
        termSheetUri: termSheetUri(sheetHash),
        units: BigInt(c.n.units),
        open: true,
        extraTopics: [],
        extraIssuers: [],
      };
      const data = encodeFunctionData({ abi: FACTORY, functionName: "issue", args: [params] });
      // Simulated from the Issuer's wallet first, so a refusal is the factory's own reason.
      await c.s.publicClient.call({ account: issuerWallet, to: c.factory, data }).catch((e) => {
        throw new Error(`the factory refuses this note: ${(e as Error).message.split("\n")[0]}`);
      });
      const hash = await execThroughWallet(c.s, issuerWallet, ISSUER_OWNERS, "issuer", c.factory, data);
      const receipt = await c.s.publicClient.waitForTransactionReceipt({ hash });
      const [issued] = parseEventLogs({ abi: FACTORY, eventName: "NoteIssued", logs: receipt.logs });
      if (receipt.status !== "success" || !issued) throw new Error(`the issuance reverted (${hash})`);
      return issuedPatch(c, issued.args.note, hash, calendar, sheetHash);
    },
  },
  {
    label: "The bank funds the Agent for coupons and redemptions",
    run: async (c) => {
      // Enough to pay every coupon and redeem at the most the note can pay: twice the Calculation Amount per unit.
      // The Agent approves the Paying Agent for each distribution's exact amount when it opens.
      const ca = c.scenario ? c.scenario.terms.calculationAmountCents : Number(c.n.data.calculationAmountCents);
      const amount = BigInt(c.n.units) * BigInt(ca) * 2n;
      const h = await c.s.send("depositAgent", { address: c.m.instruments!.gateway, abi: GATEWAY, functionName: "credit", args: [c.s.address("agent"), amount, keccak256(toBytes(`${c.n.symbol}/funding/${randomBytes(4).toString("hex")}`))] });
      return tx("funding", h)(c.n);
    },
  },
];

export const ISSUANCE_STEPS = STEPS.map((s) => s.label);

/** Starts a note; the first step runs at once, the rest as the page asks. */
/** An ISIN: a country code, nine characters, and a check digit (ISO 6166). */
export function isinProblem(isin: string): string | null {
  if (!isin) return null;
  if (!/^[A-Z]{2}[A-Z0-9]{9}[0-9]$/.test(isin)) return "An ISIN is twelve characters: two letters for the country, nine letters or digits, and a check digit.";
  // The check digit: letters become numbers (A = 10), then the Luhn sum.
  const digits = isin.slice(0, 11).replace(/[A-Z]/g, (ch) => String(ch.charCodeAt(0) - 55));
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 0) d *= 2;
    sum += d > 9 ? d - 9 : d;
  }
  return (10 - (sum % 10)) % 10 === Number(isin[11]) ? null : "That ISIN's check digit does not match: check it against the term sheet.";
}

export async function startNote(staff: Registrant, input: { scenario: string; observations: number; interval: Interval; units: number; isin?: string }): Promise<DemoNote> {
  if (!hasRole(staff.email, "agent")) throw new Error("Not permitted.");
  const scenario = SCENARIOS.find((s) => s.name === input.scenario);
  if (!scenario) throw new Error("Choose a scenario.");
  const problem = calendarProblem(input.observations, input.interval);
  if (problem) throw new Error(problem);
  if (!Number.isInteger(input.units) || input.units < 1 || input.units > 100) throw new Error("Issue between 1 and 100 units.");
  const isin = (input.isin ?? "").trim().toUpperCase();
  const bad = isinProblem(isin);
  if (bad) throw new Error(bad);
  const store = getStore();
  const m: Manifest = loadManifest();
  const live = { name: await readLive(m, "name"), symbol: await readLive(m, "symbol") };
  // The next series the factory will number, past any the site has started and not yet issued,
  // so two issuances started together carry different names.
  const stored = await store.listNotes();
  if (isin && stored.some((x) => x.isin === isin && x.status !== "failed")) throw new Error("A note with that ISIN is already issued or being issued.");
  const onChain = Number(await context().s.publicClient.readContract({ address: context().factory, abi: FACTORY, functionName: "seriesCount" }));
  const series = Math.max(onChain, ...stored.map((x) => x.series)) + 1;
  const n: DemoNote = {
    id: `note_${randomBytes(9).toString("base64url")}`,
    series,
    ...(isin ? { isin } : {}),
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

/**
 * Staff issue a note from a term sheet they upload: the record is the note's terms and its
 * published term sheet, as it stands. Checked first: against the schema, against this network, its
 * ISIN, its dates still to come, and its symbol not already used.
 */
export async function startNoteFromTermSheet(staff: Registrant, raw: string): Promise<DemoNote> {
  if (!hasRole(staff.email, "agent")) throw new Error("Not permitted.");
  let record: TermSheet;
  try {
    record = JSON.parse(raw);
  } catch {
    throw new Error("The term sheet is not JSON: upload the record as the site publishes term sheets.");
  }
  if (record?.schema !== SCHEMA) throw new Error(`This is not a term sheet record: its schema should be ${SCHEMA}.`);
  const problems = validate(record);
  if (problems.length) throw new Error(`The term sheet is not complete: ${problems.slice(0, 5).join("; ")}${problems.length > 5 ? `; and ${problems.length - 5} more` : ""}.`);
  const m = loadManifest();
  const f = record.fields;
  if (Number(value(f.chainId)) !== m.chainId) throw new Error(`The term sheet is for network ${value(f.chainId)}; this deployment is on ${m.chainId}.`);
  const isin = isNA(f.isin) ? "" : String(value(f.isin) ?? "").trim().toUpperCase();
  const bad = isinProblem(isin);
  if (bad) throw new Error(bad);
  const units = Number(value(f.issueSizeUnits));
  if (!Number.isInteger(units) || units < 1 || units > 1_000_000) throw new Error("The issue size is between 1 and 1,000,000 units.");
  const calendar = value<Item[]>(f.calendar) ?? [];
  const now_ = Number((await context().s.publicClient.getBlock()).timestamp);
  if (Number(value(calendar[0]?.recordTime)) <= now_ + 60) throw new Error("The term sheet's first Record Time has passed, or is under a minute away: give dates still to come.");
  const symbol = String(value(f.symbol));
  const name = String(value(f.name));
  const store = getStore();
  const stored = await store.listNotes();
  if (stored.some((x) => x.symbol === symbol && x.status !== "failed") || symbol === (await readLive(m, "symbol"))) throw new Error(`The symbol ${symbol} is already used by a note.`);
  if (isin && stored.some((x) => x.isin === isin && x.status !== "failed")) throw new Error("A note with that ISIN is already issued or being issued.");
  const hash = await keepTermSheet(record);
  const onChain = Number(await context().s.publicClient.readContract({ address: context().factory, abi: FACTORY, functionName: "seriesCount" }));
  const n: DemoNote = {
    id: `note_${randomBytes(9).toString("base64url")}`,
    series: Math.max(onChain, ...stored.map((x) => x.series)) + 1,
    ...(isin ? { isin } : {}),
    name,
    symbol,
    scenario: "",
    observations: calendar.length,
    units,
    status: "issuing",
    step: 0,
    createdAt: now(),
    by: staff.email,
    addresses: {},
    txs: {},
    data: { termSheet: hash, calculationAmountCents: Number(value(f.calculationAmountCents)) },
  };
  await store.putNote(n);
  await store.audit({ at: now(), actor: staff.email, action: `started issuing ${name} (${symbol}) from term sheet ${hash}: ${units} units, ${calendar.length} observations`, subject: n.id });
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

/** Staff stop an issuance that will not finish. Whatever already landed on the chain stays. */
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
  // A step in flight. The page polls every few seconds while a step on Ethereum Sepolia
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
  const scenario = SCENARIOS.find((s) => s.name === n.scenario);
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
