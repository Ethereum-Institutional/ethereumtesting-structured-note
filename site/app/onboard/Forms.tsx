"use client";

import { useActionState } from "react";
import { PendingButton } from "../PendingButton";

type Result = { ok?: string; error?: string };

/** The client asks for access to the note, answering the selling restrictions (ADR 0089). */
export function NoteRequestForm({ id, action, investorClass }: { id: string; action: (prev: Result, f: FormData) => Promise<Result>; investorClass?: string }) {
  const [state, run] = useActionState(action, {});
  return (
    <form action={run} className="stack">
      <input type="hidden" name="id" value={id} />
      <label style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
        <input type="checkbox" name="notUsPerson" required /> We are not a U.S. person, and do not acquire the note for one (Regulation S).
      </label>
      <label>
        Our investor class
        <select name="investorClass" defaultValue={investorClass ?? "institutional"}>
          <option value="institutional">Institutional</option>
          <option value="professional">Professional</option>
        </select>
      </label>
      <label style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
        <input type="checkbox" name="relyOnBankKyb" required /> The onboarding agent may rely on our bank's KYB rather than repeat it.
      </label>
      <div className="actions"><PendingButton working="Asking…">Ask for access to the note</PendingButton></div>
      {state.error && <p role="alert" className="notice err">{state.error}</p>}
      {state.ok && <p role="status" className="muted">{state.ok}</p>}
    </form>
  );
}

/** An identity the client already has, from another institution (Q2). */
export function BringIdentityForm({ action }: { action: (prev: Result, f: FormData) => Promise<Result> }) {
  const [state, run] = useActionState(action, {});
  return (
    <form action={run} className="stack">
      <label>Your identity's address<input name="identity" required pattern="0x[0-9a-fA-F]{40}" placeholder="0x…" /></label>
      <div className="actions"><PendingButton working="Recording…">Bring this identity</PendingButton></div>
      {state.error && <p role="alert" className="notice err">{state.error}</p>}
      {state.ok && <p role="status" className="muted">{state.ok}</p>}
    </form>
  );
}
