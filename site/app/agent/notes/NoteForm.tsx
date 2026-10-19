"use client";

import { useActionState, useEffect, useState } from "react";
import { calendar, calendarProblem, lifeOf, MAX_OBSERVATIONS, offerEnds, offerProblem, UNITS, type Unit } from "@/lib/notes/calendar";
import { PendingButton } from "../../PendingButton";

/**
 * Issuing a demonstration note: the scenario, an offer period for placing units before the first
 * observation, the number of observations (coupon dates) and the time between them. The calendar is
 * previewed from now, as the server will fix it from the block that fixes the terms: when the offer
 * period ends, each date, its record and payment times, and the note's whole life. A refusal, of an
 * ISIN or a calendar, is shown here.
 */
type Result = { ok?: string; error?: string };
export function NoteForm({ action, scenarios }: { action: (prev: Result, f: FormData) => Promise<Result>; scenarios: Array<{ name: string; summary: string }> }) {
  const [state, run] = useActionState(action, {});
  const [observations, setObservations] = useState(4);
  const [value, setValue] = useState(10);
  const [unit, setUnit] = useState<Unit>("minutes");
  // Every field is held here, so a refusal leaves the form as it was filled rather than reset.
  const [scenario, setScenario] = useState("");
  const [units, setUnits] = useState(20);
  const [isin, setIsin] = useState("");
  const [offerValue, setOfferValue] = useState(30);
  const [offerUnit, setOfferUnit] = useState<Unit>("minutes");
  const interval = { value, unit };
  const offer = { value: offerValue, unit: offerUnit };
  const problem = offerProblem(offer) ?? calendarProblem(observations, interval);
  // "Now" is taken in the browser, after the page has hydrated: taken while rendering, the server's
  // minute and the browser's could differ, and the preview would not match the page it came with.
  const [start, setStart] = useState<number | null>(null);
  useEffect(() => setStart(Math.floor(Date.now() / 1000)), [observations, value, unit, offerValue, offerUnit]);
  const dates = problem || start === null ? [] : calendar(start, observations, interval, offer);
  const at = (s: number) => new Date(s * 1000).toISOString().slice(0, 16).replace("T", " ") + " UTC";

  return (
    <form action={run} className="stack">
      <div className="fields">
        <label>
          Scenario
          <select name="scenario" required value={scenario} onChange={(e) => setScenario(e.target.value)}>
            <option value="" disabled>Choose what happens…</option>
            {scenarios.map((s) => <option key={s.name} value={s.name}>{s.summary}</option>)}
          </select>
        </label>
        <label title="Time after issuance to credit deposits and place units, before the first observation. Units can still be bought later, but the first coupon goes to whoever holds at its record time.">
          Offer period before the first date
          <span style={{ display: "flex", gap: "0.5rem" }}>
            <input name="offerValue" aria-label="Offer period" type="number" min={1} value={offerValue} onChange={(e) => setOfferValue(Number(e.target.value))} required style={{ maxWidth: "6rem" }} />
            <select name="offerUnit" aria-label="Offer period unit" value={offerUnit} onChange={(e) => setOfferUnit(e.target.value as Unit)}>
              {UNITS.filter((u) => u !== "months").map((u) => <option key={u} value={u}>{u}</option>)}
            </select>
          </span>
        </label>
        <label>
          Observations (coupon dates)
          <input name="observations" type="number" min={1} max={MAX_OBSERVATIONS} value={observations} onChange={(e) => setObservations(Number(e.target.value))} required />
        </label>
        <label>
          Time between observations
          <span style={{ display: "flex", gap: "0.5rem" }}>
            <input name="intervalValue" aria-label="Time between observations" type="number" min={1} value={value} onChange={(e) => setValue(Number(e.target.value))} required style={{ maxWidth: "6rem" }} />
            <select name="intervalUnit" aria-label="Unit" value={unit} onChange={(e) => setUnit(e.target.value as Unit)}>
              {UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
            </select>
          </span>
        </label>
        <label>Units<input name="units" type="number" min={1} max={100} value={units} onChange={(e) => setUnits(Number(e.target.value))} required /></label>
        <label title="Optional. The note's ISIN, stated on its identity beside the series number the factory assigns.">
          ISIN (optional)
          <input name="isin" maxLength={12} value={isin} onChange={(e) => setIsin(e.target.value)} pattern="[A-Za-z]{2}[A-Za-z0-9]{9}[0-9]" placeholder="XS0000000000" style={{ textTransform: "uppercase" }} />
        </label>
      </div>
      {problem ? (
        <p role="alert" className="notice err">{problem}</p>
      ) : start === null ? null : (
        <div className="notice ok" role="note">
          <strong>Offer period until {at(offerEnds(start, offer))}; then {observations} observation{observations === 1 ? "" : "s"}, maturity {at(dates.at(-1)!.date)}; the note's whole life is about {lifeOf(start, dates)}.</strong>
          <ol style={{ margin: "0.5rem 0 0", paddingLeft: "1.25rem" }}>
            {dates.map((d, i) => (
              <li key={i}>{at(d.date)} · record {at(d.recordTime).slice(5)} · paid {at(d.paymentDate).slice(5)}</li>
            ))}
          </ol>
          {observations !== 4 && <p className="muted" style={{ margin: "0.5rem 0 0" }}>The scenario is stretched to {observations} dates. Only a four-date note is checked payment by payment against the independent payoff model.</p>}
        </div>
      )}
      <div className="actions">
        <PendingButton working="Starting the issuance…">Issue</PendingButton>
      </div>
      {state.error && <p role="alert" className="notice err">{state.error}</p>}
      {state.ok && <p role="status" className="muted">{state.ok}</p>}
    </form>
  );
}
