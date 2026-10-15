"use client";

import { useActionState } from "react";
import { PendingButton } from "../PendingButton";

export type ActionState = { ok?: string; error?: string };

/**
 * A form whose action says how it went, beside its button: the refusal of a contract, in words, or
 * what was done. For the lifecycle's steps, where a refusal is the useful answer (ADR 0078).
 */
export function ActionForm({
  action,
  hidden,
  label,
  working,
  quiet,
  children,
}: {
  action: (prev: ActionState, f: FormData) => Promise<ActionState>;
  hidden: Record<string, string>;
  label: string;
  working: string;
  quiet?: boolean;
  children?: React.ReactNode;
}) {
  const [state, run] = useActionState(action, {});
  return (
    <form action={run} className="stack">
      {Object.entries(hidden).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
      {children}
      <div className="actions">
        <PendingButton className={quiet ? "quiet" : undefined} working={working}>{label}</PendingButton>
        {state.ok && <span role="status" className="muted">{state.ok}</span>}
      </div>
      {state.error && <p role="alert" className="notice err">{state.error}</p>}
    </form>
  );
}
