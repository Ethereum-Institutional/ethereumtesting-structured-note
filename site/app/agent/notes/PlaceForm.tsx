"use client";

import { useActionState } from "react";
import { PendingButton } from "../../PendingButton";

export type Placeable = { id: string; label: string; regS: boolean };

/**
 * Placing units with an onboarded account (ADRs 0075, 0089): the account, the units and the price a unit.
 * The note is asked first whether its leg could move, so an account the onboarding agent has not vouched for is
 * refused here with its reason (S-09), before anything is sent.
 */
export function PlaceForm({
  noteId,
  accounts,
  inventory,
  action,
}: {
  noteId: string;
  accounts: Placeable[];
  inventory: number;
  action: (prev: { ok?: string; error?: string }, f: FormData) => Promise<{ ok?: string; error?: string }>;
}) {
  const [state, run] = useActionState(action, {});
  if (!accounts.length) return <p className="muted">No account is admitted: onboard one first.</p>;
  return (
    <form action={run} className="stack">
      <input type="hidden" name="noteId" value={noteId} />
      <div className="fields">
        <label>
          Account
          <select name="admission" required defaultValue="">
            <option value="" disabled>Choose the account…</option>
            {accounts.map((a) => <option key={a.id} value={a.id}>{a.label}{a.regS ? "" : " (not eligible for the note)"}</option>)}
          </select>
        </label>
        <label>Units<input name="units" type="number" min={1} max={inventory} step={1} required defaultValue={1} /></label>
        <label>Price a unit (€)<input name="price" required inputMode="decimal" defaultValue="1000.00" /></label>
      </div>
      <div className="actions">
        <PendingButton working="Asking the note, then offering the units: a custody account accepts in the same action.">Place units</PendingButton>
      </div>
      {state.error && <p role="alert" className="notice err">{state.error}</p>}
      {state.ok && <p role="status" className="notice">{state.ok}</p>}
    </form>
  );
}
