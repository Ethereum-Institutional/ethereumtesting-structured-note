"use client";

import { useActionState } from "react";
import type { FormState } from "../actions";
import { PendingButton } from "../PendingButton";

/** Sends a fresh confirmation link to a registration that has not confirmed its address (ADR 0077). */
export function ResendLink({ id, email, action }: { id: string; email: string; action: (prev: FormState, f: FormData) => Promise<FormState> }) {
  const [state, run] = useActionState(action, {});
  return (
    <form action={run} className="actions">
      <input type="hidden" name="id" value={id} />
      <PendingButton className="quiet" working="Sending…">Resend link</PendingButton>
      {state.sent && <span role="status" className="muted">Sent a fresh link to {email}.</span>}
      {state.error && <span role="alert" className="muted">{state.error}</span>}
    </form>
  );
}
