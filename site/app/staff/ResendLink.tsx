"use client";

import { useActionState } from "react";
import type { FormState } from "../actions";
import { PendingButton } from "../PendingButton";

/** Sends a fresh confirmation code to a registration that has not confirmed its address. */
export function ResendLink({ id, email, action }: { id: string; email: string; action: (prev: FormState, f: FormData) => Promise<FormState> }) {
  const [state, run] = useActionState(action, {});
  return (
    <form action={run} className="actions">
      <input type="hidden" name="id" value={id} />
      <PendingButton className="quiet" working="Sending…">Resend code</PendingButton>
      {state.sent && <span role="status" className="muted">Sent a fresh code to {email}.</span>}
      {state.error && <span role="alert" className="muted">{state.error}</span>}
    </form>
  );
}
