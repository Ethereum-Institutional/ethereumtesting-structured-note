/**
 * The deployment's term sheet, built before the note is issued: the record, its hash,
 * the address it is published at, and the terms derived from it, which the issuance script reads.
 * Run by ops/deploy-stack.sh from the repository root:
 *
 *   node site/scripts/term-sheet.ts
 *
 * The figures are the payoff specification's illustrative ones (spike 3), with Twin Win applicable
 * (C5), until the bank's term sheet gives them. Dates are offsets from the chain's own
 * clock: four quarterly observations, each with its Record Time two days and its Payment Date five
 * days after it. Off the local node, NOTE_NAME, NOTE_SYMBOL and TERM_SHEET_BASE must be set.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createPublicClient, http } from "viem";
import { hashOf, termSheetFrom, toTerms, validate } from "../lib/notes/termsheet.ts";

const ROOT = join(import.meta.dirname, "..", "..");
const RPC = process.env.RPC ?? "http://127.0.0.1:8545";
const MANIFEST = join(ROOT, process.env.MANIFEST ?? "ops/addresses.json");
const OUT = join(ROOT, process.env.TERM_SHEET_FILE ?? "ops/term-sheet.json");
const QUARTER = 91 * 86_400;
const UNITS = 100;

const client = createPublicClient({ transport: http(RPC) });
const chainId = await client.getChainId();
const local = chainId === 31337;
const param = (key: string, localDefault: string) => {
  const set = process.env[key]?.trim();
  if (set) return set;
  if (local) return localDefault;
  throw new Error(`${key} must be set off the local node`);
};
const manifest = JSON.parse(readFileSync(MANIFEST, "utf8"));
const now = Number((await client.getBlock()).timestamp);

const record = termSheetFrom({
  name: param("NOTE_NAME", "EUR Worst-of Autocallable Note"),
  symbol: param("NOTE_SYMBOL", "EURWAN"),
  chainId,
  issueSizeUnits: UNITS,
  strikeTime: now,
  initialLevels: [451_200, 1_820_300, 25_000],
  calculationAmountCents: 100_000,
  couponBarrierBps: 7_000,
  couponRateBps: 250,
  memory: false,
  barrierBps: 6_000,
  twinWin: { applies: true, upBps: 10_000, downBps: 10_000, capBps: 15_000 },
  schedule: [0, 1, 2, 3].map((k) => {
    const date = now + (k + 1) * QUARTER;
    return { date, recordTime: date + 2 * 86_400, paymentDate: date + 5 * 86_400, coupon: true, mer: k < 3, barrier: k === 3, isFinal: k === 3, merTriggerBps: k < 3 ? 10_000 : 0 };
  }),
  depositSymbol: manifest.assets?.deposit?.symbol ?? "EURTD",
});
const problems = validate(record);
if (problems.length) throw new Error(`the deployment's term sheet is not valid: ${problems.join("; ")}`);
const hash = hashOf(record);
const uri = `${param("TERM_SHEET_BASE", "http://localhost:3020").replace(/\/+$/, "")}/term-sheets/${hash}`;
const t = toTerms(record);
// The terms flat, as the issuance script parses them.
const terms = {
  initialLevels: t.initialLevels.map(Number),
  calculationAmountCents: Number(t.calculationAmountCents),
  couponBarrierBps: t.couponBarrierBps,
  couponRateBps: t.couponRateBps,
  memory: t.memory_,
  barrierBps: t.barrierBps,
  twinWin: t.twinWin,
  scheduleLength: t.schedule.length,
  schedule: t.schedule,
  units: UNITS,
};
writeFileSync(OUT, JSON.stringify({ hash, uri, terms, record }, null, 2) + "\n");
console.log(`term sheet ${hash} -> ${uri}`);
