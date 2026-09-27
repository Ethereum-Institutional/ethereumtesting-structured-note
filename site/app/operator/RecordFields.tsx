"use client";

import { useId, useState } from "react";
import { JURISDICTIONS } from "@/lib/jurisdictions";

/**
 * The bank's record fields that the pool can refuse, each warned about here, before the form is
 * sent; the server and the pool gate refuse them regardless.
 */

/**
 * The client's jurisdiction, chosen by name. A jurisdiction outside the pool's allowlist is warned
 * about here, before the form is sent; the server refuses it regardless.
 */
export function JurisdictionSelect({ allowed }: { allowed: string[] }) {
  const [code, setCode] = useState("");
  const warning = useId();
  const refused = code !== "" && !allowed.includes(code);
  const name = JURISDICTIONS.find(([c]) => c === code)?.[1];
  return (
    <label>
      Jurisdiction
      <select name="jurisdiction" required value={code} onChange={(e) => setCode(e.target.value)} aria-describedby={refused ? warning : undefined}>
        <option value="" disabled>Choose the jurisdiction…</option>
        {JURISDICTIONS.map(([c, n]) => (
          <option key={c} value={c}>{n} - {c}</option>
        ))}
      </select>
      {refused && (
        <span id={warning} role="alert" className="notice err">
          {name} ({code}) is outside the pool's jurisdictions. An admission for this client will be refused.
        </span>
      )}
    </label>
  );
}

const DAY = 86_400_000;
const utcDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/**
 * The bank's latest sanctions screening. A date in the future is refused, and so is one older than
 * the pool gate's screening maximum age. Dates are UTC days, as the server reads them.
 */
export function ScreeningDate({ maxAgeDays }: { maxAgeDays: number }) {
  const [day, setDay] = useState("");
  const warning = useId();
  const today = utcDay(Date.now());
  const oldest = utcDay(Date.now() - maxAgeDays * DAY);
  const problem =
    day > today ? "This date is in the future. An admission with a future screening date will be refused."
    : day !== "" && day < oldest ? `This screening is older than ${maxAgeDays} days. The pool will refuse it: screen the client again first.`
    : null;
  return (
    <label>
      Last sanctions screening
      <input
        name="screenedOn"
        type="date"
        value={day}
        onChange={(e) => setDay(e.target.value)}
        aria-invalid={problem ? true : undefined}
        aria-describedby={warning}
        style={problem ? { borderColor: "var(--seal)" } : undefined}
      />
      {problem ? (
        <span id={warning} role="alert" className="notice err">{problem}</span>
      ) : (
        <span id={warning} className="muted">Left blank, today is recorded.</span>
      )}
    </label>
  );
}
