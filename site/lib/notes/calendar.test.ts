import { test } from "node:test";
import assert from "node:assert/strict";
import { calendar, offerProblem, calendarProblem, lifeOf, stretch } from "./calendar.ts";
import scenarios from "./scenarios.json" with { type: "json" };

const DAY = 86_400;
const START = Date.UTC(2026, 9, 1, 12, 0, 0) / 1000;

test("a quarterly calendar has the real note's lags: record 2 days, payment 5 days after each observation", () => {
  const dates = calendar(START, 4, { value: 3, unit: "months" });
  assert.deepEqual(dates.map((d) => new Date(d.date * 1000).toISOString().slice(0, 10)), ["2027-01-01", "2027-04-01", "2027-07-01", "2027-10-01"]);
  for (const d of dates) {
    assert.equal(d.recordTime - d.date, 2 * DAY);
    assert.equal(d.paymentDate - d.date, 5 * DAY);
  }
  assert.equal(lifeOf(START, dates), "1 year");
});

test("a calendar of minutes keeps its lags inside the period: a fifth and two fifths of the gap", () => {
  const dates = calendar(START, 3, { value: 5, unit: "minutes" });
  assert.deepEqual(dates.map((d) => d.date - START), [300, 600, 900]);
  assert.deepEqual(dates.map((d) => [d.recordTime - d.date, d.paymentDate - d.date]), [[60, 120], [60, 120], [60, 120]]);
  assert.equal(lifeOf(START, dates), "17 minutes");
});

test("choices outside what a note can carry are refused", () => {
  assert.match(calendarProblem(0, { value: 5, unit: "minutes" })!, /between 1 and 12/);
  assert.match(calendarProblem(13, { value: 5, unit: "minutes" })!, /between 1 and 12/);
  assert.match(calendarProblem(4, { value: 1, unit: "minutes" })!, /at least 2 minutes/);
  assert.match(calendarProblem(12, { value: 12, unit: "months" })!, /ten years/);
  assert.equal(calendarProblem(4, { value: 3, unit: "months" }), null);
});

test("a scenario stretched to more dates keeps its early dates and its maturity; only four dates check against the model", () => {
  const mer = scenarios.find((s) => s.name === "mer-at-trigger")!;
  const six = stretch(mer, 6);
  assert.equal(six.schedule.length, 6);
  assert.deepEqual(six.levels[1], mer.levels[1], "the early redemption's date keeps its levels");
  assert.deepEqual(six.levels[5], mer.levels[3], "the last date has the scenario's maturity");
  assert.equal(six.schedule[5].isFinal, true);
  assert.ok(six.schedule.slice(0, 5).every((o) => !o.isFinal));
  assert.equal(six.expected, null);
  assert.deepEqual(stretch(mer, 4).expected, mer.expected);
  const one = stretch(mer, 1);
  assert.equal(one.schedule[0].isFinal, true, "a single date is the maturity");
});

test("an offer period comes before the first date, whatever the spacing of the dates after it", () => {
  const start = 1_800_000_000;
  const d = calendar(start, 3, { value: 2, unit: "minutes" }, { value: 10, unit: "minutes" });
  assert.deepEqual(d.map((x) => x.date - start), [600, 720, 840], "the first at the end of the offer period, then every two minutes");
  assert.deepEqual(d.map((x) => x.recordTime - x.date), [24, 24, 24], "each record time a fifth of the spacing after its date, the first too");
  assert.equal(offerProblem({ value: 0, unit: "minutes" }), "The offer period is a whole number, at least 1.");
  assert.equal(offerProblem({ value: 2, unit: "months" }), "Give the offer period in minutes, hours or days.");
  assert.equal(offerProblem({ value: 10, unit: "minutes" }), null);
});
