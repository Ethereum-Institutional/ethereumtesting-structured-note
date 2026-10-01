/**
 * A note's calendar and its scenario, from what staff choose at issuance (ADR 0073): the number of
 * observations (coupon dates), and the time between them. Pure, so the form previews exactly
 * what the server fixes on-chain.
 *
 * Each observation's record time comes a fifth of the way to the next, and its payment date two
 * fifths, but at most 2 and 5 days after it: a quarterly calendar then has the real note's 2 and 5
 * days, and a calendar of minutes stays inside its own period.
 */

export type Unit = "minutes" | "hours" | "days" | "months";
export type Interval = { value: number; unit: Unit };
export type Dates = { date: number; recordTime: number; paymentDate: number };

export const UNITS: Unit[] = ["minutes", "hours", "days", "months"];
export const MAX_OBSERVATIONS = 12;
const SECONDS: Record<Exclude<Unit, "months">, number> = { minutes: 60, hours: 3600, days: 86_400 };
const DAY = 86_400;

/** What is wrong with a choice of calendar, or null. */
export function calendarProblem(observations: number, interval: Interval): string | null {
  if (!Number.isInteger(observations) || observations < 1 || observations > MAX_OBSERVATIONS) return `Choose between 1 and ${MAX_OBSERVATIONS} observations.`;
  if (!UNITS.includes(interval.unit)) return "Choose a unit.";
  if (!Number.isInteger(interval.value) || interval.value < 1) return "The time between observations is a whole number, at least 1.";
  if (interval.unit === "minutes" && interval.value < 2) return "Allow at least 2 minutes between observations.";
  const months = interval.unit === "months" ? interval.value * observations : (interval.value * SECONDS[interval.unit] * observations) / (30 * DAY);
  if (months > 120) return "The note's life is at most ten years.";
  return null;
}

/** The observation dates, `observations` of them, from `startSec`. */
export function calendar(startSec: number, observations: number, interval: Interval): Dates[] {
  const dates: number[] = [];
  for (let k = 1; k <= observations; k++) {
    if (interval.unit === "months") {
      const d = new Date(startSec * 1000);
      d.setUTCMonth(d.getUTCMonth() + k * interval.value);
      dates.push(Math.floor(d.getTime() / 1000));
    } else {
      dates.push(startSec + k * interval.value * SECONDS[interval.unit]);
    }
  }
  return dates.map((date, i) => {
    const gap = date - (i === 0 ? startSec : dates[i - 1]);
    return { date, recordTime: date + Math.min(Math.floor(gap / 5), 2 * DAY), paymentDate: date + Math.min(Math.floor((2 * gap) / 5), 5 * DAY) };
  });
}

/** The note's whole life, from issuance to the last payment, in words. */
export function lifeOf(startSec: number, dates: Dates[]): string {
  const s = dates.length ? dates.at(-1)!.paymentDate - startSec : 0;
  if (s < 2 * 3600) return `${Math.round(s / 60)} minutes`;
  if (s < 3 * DAY) return `${Math.round((s / 3600) * 10) / 10} hours`;
  if (s < 120 * DAY) return `${Math.round(s / DAY)} days`;
  const years = Math.round((s / (365 * DAY)) * 10) / 10;
  return `${years} year${years === 1 ? "" : "s"}`;
}

export type ScenarioShape = {
  terms: { schedule: Array<{ coupon: boolean; mer: boolean; barrier: boolean; isFinal: boolean; merTriggerBps: number }> };
  levels: number[][];
  expected: Array<Array<{ kind: string; perCaCents: number }>>;
};

/**
 * A four-date scenario on `n` dates: its first three dates' pattern on the early dates (the last of
 * them repeated if there are more), its maturity on the last. An early redemption therefore still
 * happens on its date, and the barrier is breached or not at maturity, as in the scenario.
 */
export function stretch<S extends ScenarioShape>(s: S, n: number) {
  const from = (k: number) => (k === n - 1 ? 3 : Math.min(k, 2));
  return {
    schedule: Array.from({ length: n }, (_, k) => s.terms.schedule[from(k)]),
    levels: Array.from({ length: n }, (_, k) => s.levels[from(k)]),
    /** The independent model's expected payments: exact only on the scenario's own four dates. */
    expected: n === 4 ? s.expected : null,
  };
}
