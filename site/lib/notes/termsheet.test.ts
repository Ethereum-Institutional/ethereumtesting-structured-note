import { test } from "node:test";
import assert from "node:assert/strict";
import { FIELDS, canonical, differences, hashOf, na, termSheetFrom, toTerms, v, validate, type Basis, type TermSheet } from "./termsheet.ts";

const Q = 91 * 86_400;
const T0 = 1_790_000_000;
const basis: Basis = {
  name: "EUR Worst-of Autocallable Note",
  symbol: "EURWAN",
  chainId: 31337,
  issueSizeUnits: 100,
  strikeTime: T0,
  initialLevels: [451_200, 1_820_300, 25_000],
  calculationAmountCents: 100_000,
  couponBarrierBps: 7_000,
  couponRateBps: 250,
  memory: false,
  barrierBps: 6_000,
  twinWin: { applies: true, upBps: 10_000, downBps: 10_000, capBps: 15_000 },
  schedule: [0, 1, 2, 3].map((k) => {
    const date = T0 + (k + 1) * Q;
    return { date, recordTime: date + 2 * 86_400, paymentDate: date + 5 * 86_400, coupon: true, mer: k < 3, barrier: k === 3, isFinal: k === 3, merTriggerBps: k < 3 ? 10_000 : 0 };
  }),
  depositSymbol: "EURTD",
};
const clone = (t: TermSheet): TermSheet => JSON.parse(JSON.stringify(t));

test("a record built from our instrument terms is complete, and gives exactly those terms", () => {
  const t = termSheetFrom(basis);
  assert.deepEqual(validate(t), []);
  assert.deepEqual(Object.keys(t.fields).sort(), FIELDS.map((f) => f.id).sort(), "every field of the catalogue, and no other");
  const terms = toTerms(t);
  assert.deepEqual(terms.initialLevels, [451_200n, 1_820_300n, 25_000n]);
  assert.deepEqual(terms.twinWin, { applies: true, upBps: 10_000, downBps: 10_000, capBps: 15_000 });
  assert.equal(terms.schedule.length, 4);
  assert.deepEqual(terms.schedule[3], { ...basis.schedule[3] });
  assert.equal(t.fields.maturityDate && "value" in t.fields.maturityDate && t.fields.maturityDate.value, new Date((T0 + 4 * Q + 5 * 86_400) * 1000).toISOString().slice(0, 10));
});

test("every field carries a value or says not applicable; only some may", () => {
  const t = termSheetFrom(basis);
  const missing = clone(t);
  delete missing.fields.isin;
  assert.match(validate(missing).join(), /isin: missing; give a value or "not applicable"/);
  const notAllowed = clone(t);
  notAllowed.fields.couponRateBps = na();
  assert.match(validate(notAllowed).join(), /couponRateBps: may not be "not applicable"/);
  const wrongType = clone(t);
  wrongType.fields.barrierBps = v("6000");
  assert.match(validate(wrongType).join(), /barrierBps: an integer expected/);
  const unknown = clone(t);
  unknown.fields.colour = v("blue");
  assert.match(validate(unknown).join(), /colour: not a field of the term sheet/);
  const halfTwin = clone(t);
  halfTwin.fields.twinWinDownsideBps = na();
  assert.match(validate(halfTwin).join(), /upside and downside participation are applicable together/);
  const merWithoutTrigger = clone(t);
  (merWithoutTrigger.fields.calendar as { value: Array<Record<string, unknown>> }).value[0].merTriggerBps = na();
  assert.match(validate(merWithoutTrigger).join(), /calendar\[0\]\.merTriggerBps: the MER test applies/);
  assert.throws(() => toTerms(notAllowed), /cannot be issued/);
});

test("the hash is of the canonical form: the same record hashes the same whatever the order of its keys", () => {
  const t = termSheetFrom(basis);
  const reordered = { fields: Object.fromEntries(Object.entries(t.fields).reverse()), schema: t.schema } as TermSheet;
  assert.equal(hashOf(reordered), hashOf(t));
  assert.equal(canonical({ b: 1, a: [true, "x"] }), '{"a":[true,"x"],"b":1}');
  const changed = clone(t);
  changed.fields.couponRateBps = v(251);
  assert.notEqual(hashOf(changed), hashOf(t), "any change to a field changes the hash");
  assert.throws(() => canonical({ x: 1.5 }), /integers only/);
});

test("the chain's terms are compared field by field", () => {
  const t = termSheetFrom(basis);
  assert.deepEqual(differences(t, toTerms(t)), []);
  const onChain = { ...toTerms(t), couponRateBps: 300 };
  assert.deepEqual(differences(t, onChain), ["couponRateBps: the term sheet gives 250, the chain 300"]);
});
