"use client";

import { useId, useState } from "react";
import { JURISDICTIONS } from "@/lib/jurisdictions";

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
