"use client";

import { useActionState } from "react";
import { PendingButton } from "../PendingButton";
import { JurisdictionSelect } from "./RecordFields";

export type AddClientState = { ok?: string; error?: string };

/**
 * A corporate client's facts, entered once. They stay in the bank's records; the bank's
 * claim carries only their salted hash. The result is shown here, since a refusal must not vanish
 * into a server log.
 */
export function AddClientForm({
  action,
  legalForms,
  statuses,
  prefill,
}: {
  action: (prev: AddClientState, f: FormData) => Promise<AddClientState>;
  legalForms: readonly string[];
  statuses: readonly string[];
  prefill?: { kycReference?: string };
}) {
  const [state, submit] = useActionState(action, {});
  return (
    <form action={submit} className="stack">
      <div className="fields">
        {/* The site assigns the reference; a client re-issued from the bank keeps the bank's. */}
        {prefill?.kycReference && <input type="hidden" name="kycReference" value={prefill.kycReference} />}
        <label>Legal name<input name="legalName" required maxLength={200} /></label>
        <label>
          Legal form
          <select name="legalForm" required defaultValue="">
            <option value="" disabled>Choose…</option>
            {legalForms.map((f) => <option key={f} value={f}>{f}</option>)}
          </select>
        </label>
        <label>Registration number<input name="registrationNumber" required maxLength={120} /></label>
        <JurisdictionSelect />
        <label>Incorporation date<input name="incorporationDate" type="date" required /></label>
        <label>
          Status
          <select name="status" defaultValue="active">
            {statuses.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
        <label>
          Investor class
          <select name="investorClass" defaultValue="">
            <option value="">None stated (institutional by policy)</option>
            <option value="institutional">Institutional</option>
            <option value="professional">Professional</option>
          </select>
        </label>
      </div>
      <div className="actions">
        <PendingButton working="Adding the client…">Add client</PendingButton>
      </div>
      {state.error && <p role="alert" className="notice err">{state.error}</p>}
      {state.ok && <p role="status" className="notice ok">{state.ok}</p>}
    </form>
  );
}
