"use client";

import { useActionState } from "react";
import { PendingButton } from "../PendingButton";
import { JurisdictionSelect } from "./RecordFields";

export type AddClientState = { ok?: string; error?: string };

/**
 * A corporate client's facts, entered once (ADR 0066): the schema's required claims, then what
 * is optional. The bank's issuer server signs and anchors them as the client's corporate identity.
 * The result is shown here, since a refusal must not vanish into a server log.
 */
export function AddClientForm({
  action,
  allowed,
  legalForms,
  statuses,
  prefill,
}: {
  action: (prev: AddClientState, f: FormData) => Promise<AddClientState>;
  allowed: string[];
  legalForms: readonly string[];
  statuses: readonly string[];
  prefill?: { kycReference?: string; subjectDid?: string };
}) {
  const [state, submit] = useActionState(action, {});
  return (
    <form action={submit} className="stack">
      <div className="fields">
        <label>Client reference at the bank<input name="kycReference" required maxLength={120} defaultValue={prefill?.kycReference} /></label>
        <label>Legal name<input name="legalName" required maxLength={200} /></label>
        <label>
          Legal form
          <select name="legalForm" required defaultValue="">
            <option value="" disabled>Choose…</option>
            {legalForms.map((f) => <option key={f} value={f}>{f}</option>)}
          </select>
        </label>
        <label>Registration number<input name="registrationNumber" required maxLength={120} /></label>
        <JurisdictionSelect allowed={allowed} />
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
      <details>
        <summary className="muted">The client's own DID, and its officers (optional; officers are needed for the holder-wallet route)</summary>
        <div className="fields" style={{ marginTop: "0.9rem" }}>
          <label>
            Client DID
            <input name="subjectDid" maxLength={200} defaultValue={prefill?.subjectDid} placeholder="did:elabify:…" />
            <span className="muted">Left blank, the site makes one for the client.</span>
          </label>
          <label>CEO's DID<input name="ceoOfficerDid" maxLength={200} placeholder="did:elabify:…" /></label>
          <label>COO's DID<input name="cooOfficerDid" maxLength={200} placeholder="did:elabify:…" /></label>
          <label>CFO's DID<input name="cfoOfficerDid" maxLength={200} placeholder="did:elabify:…" /></label>
        </div>
      </details>
      <div className="actions">
        <PendingButton working="The bank is issuing the corporate identity…">Add client and issue its corporate identity</PendingButton>
      </div>
      {state.error && <p role="alert" className="notice err">{state.error}</p>}
      {state.ok && <p role="status" className="notice ok">{state.ok}</p>}
    </form>
  );
}
