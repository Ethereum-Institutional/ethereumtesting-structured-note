"use client";

import { useMemo, useState } from "react";
import { calendar, calendarProblem, lifeOf, MAX_OBSERVATIONS, UNITS, type Unit } from "@/lib/notes/calendar";
import { PendingButton } from "../../PendingButton";

/**
 * Issuing a note (ADR 0073): the scenario, the number of observations (coupon dates) and the time
 * between them. The calendar is previewed from now, as the server will fix it from the block that
 * fixes the terms: each date, its record and payment times, and the note's whole life.
 */
export function NoteForm({ action, scenarios }: { action: (f: FormData) => Promise<void>; scenarios: Array<{ name: string; summary: string }> }) {
  const [observations, setObservations] = useState(4);
  const [value, setValue] = useState(10);
  const [unit, setUnit] = useState<Unit>("minutes");
  const interval = { value, unit };
  const problem = calendarProblem(observations, interval);
  const start = useMemo(() => Math.floor(Date.now() / 1000), [observations, value, unit]);
  const dates = problem ? [] : calendar(start, observations, interval);
  const at = (s: number) => new Date(s * 1000).toISOString().slice(0, 16).replace("T", " ") + " UTC";

  return (
    <form action={action} className="stack">
      <div className="fields">
        <label>
          Scenario
          <select name="scenario" required defaultValue="">
            <option value="" disabled>Choose what happens…</option>
            {scenarios.map((s) => <option key={s.name} value={s.name}>{s.summary}</option>)}
          </select>
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
        <label>Units<input name="units" type="number" min={1} max={100} defaultValue={20} required /></label>
      </div>
      {problem ? (
        <p role="alert" className="notice err">{problem}</p>
      ) : (
        <div className="notice ok" role="note">
          <strong>{observations} observation{observations === 1 ? "" : "s"}, maturity {at(dates.at(-1)!.date)}; the note's whole life is about {lifeOf(start, dates)}.</strong>
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
    </form>
  );
}
