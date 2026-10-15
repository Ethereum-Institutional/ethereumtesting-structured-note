/**
 * Exports what the site needs to issue a demonstration note (ADRs 0072, 0088): the compiled
 * lifecycle contracts it deploys, from the instruments unit's build, and the scenarios it offers,
 * from the independent payoff model's vectors. Run after the instruments are built; the output is
 * committed, since the hosted build has neither. The note's token is not exported: T-REX's factory
 * issues it on the deployment's fixed implementations, so it runs the very code under review.
 *
 *   (cd ../instruments && forge build) && node scripts/export-note-contracts.mjs
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dirname, "..", "..");
const CONTRACTS = ["DeterminationAgent", "RecordDateModule", "PayingAgent", "LockedSettlement"];
const artifacts = {};
for (const name of CONTRACTS) {
  const a = JSON.parse(readFileSync(join(root, "instruments", "out", `${name}.sol`, `${name}.json`), "utf8"));
  artifacts[name] = { abi: a.abi.filter((x) => x.type === "constructor"), bytecode: a.bytecode.object };
}
writeFileSync(join(import.meta.dirname, "..", "lib", "notes", "artifacts.json"), JSON.stringify(artifacts) + "\n");

// The scenarios offered, by the model's case names, each with the terms, each date's levels, and
// what the independent model expects to be paid, per Calculation Amount, on each date.
const CHOSEN = ["mer-first-date", "mer-at-trigger", "coupon-at-barrier", "final-one-unit-below-barrier", "twin-win-final-75"];
const vectors = JSON.parse(readFileSync(join(root, "spikes", "payoff", "vectors.json"), "utf8"));
const label = (events, dates) =>
  dates
    .map((d, i) => {
      const on = events.filter((e) => e.date === d);
      if (!on.length) return null;
      const parts = on.map((e) =>
        e.kind === "coupon" ? `coupon €${(e.per_ca_cents / 100).toFixed(2)}`
        : e.kind === "mer" ? `early redemption at €${(e.per_ca_cents / 100).toFixed(2)}`
        : `redemption at €${(e.per_ca_cents / 100).toFixed(2)}`,
      );
      return `date ${i + 1}: ${parts.join(" and ")}`;
    })
    .filter(Boolean)
    .join("; ");
const scenarios = CHOSEN.map((name) => {
  const c = vectors.cases.find((x) => x.name === name);
  if (!c) throw new Error(`no case ${name}`);
  const t = c.terms;
  const dates = t.schedule.map((o) => o.date);
  return {
    name,
    clause: c.clause,
    summary: label(c.expected.events, dates),
    terms: {
      initialLevels: t.initial_levels,
      calculationAmountCents: t.calculation_amount_cents,
      couponBarrierBps: t.coupon_barrier_bps,
      couponRateBps: t.coupon_rate_bps,
      memory: t.memory,
      barrierBps: t.barrier_bps,
      twinWin: t.twin_win ? { applies: true, upBps: t.twin_win.up_participation_bps, downBps: t.twin_win.down_participation_bps, capBps: t.twin_win.cap_bps ?? 0 } : { applies: false, upBps: 0, downBps: 0, capBps: 0 },
      schedule: t.schedule.map((o) => ({ coupon: o.coupon, mer: o.mer, barrier: o.barrier, isFinal: o.final, merTriggerBps: o.mer_trigger_bps ?? 0 })),
    },
    levels: dates.map((d) => c.determinations[d]),
    expected: dates.map((d) => c.expected.events.filter((e) => e.date === d).map((e) => ({ kind: e.kind, perCaCents: e.per_ca_cents }))),
  };
});
writeFileSync(join(import.meta.dirname, "..", "lib", "notes", "scenarios.json"), JSON.stringify(scenarios, null, 1) + "\n");
console.log(`exported ${CONTRACTS.length} contracts and ${scenarios.length} scenarios`);
for (const s of scenarios) console.log(` ${s.name}: ${s.summary}`);
