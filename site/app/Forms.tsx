"use client";

import { useActionState } from "react";
import { confirmCodeAction, registerAction, signInAction, type FormState } from "./actions";

const SENT = "If the address can be used, a six-digit code has been sent to it. It is valid for 10 minutes and can be used once.";

/** The code the visitor was sent, typed here, or on the page the mail links to. */
export function CodeForm({ email, notice = SENT }: { email: string; notice?: string }) {
  const [state, action, pending] = useActionState(confirmCodeAction, { sent: true, email });
  return (
    <form action={action} className="stack">
      <p className="notice ok" role="status">{notice}</p>
      <input type="hidden" name="email" value={email} />
      <label>
        Code
        <input type="text" name="code" inputMode="numeric" autoComplete="one-time-code" pattern="\s*\d{3}\s*\d{3}\s*" maxLength={9} required autoFocus />
      </label>
      <button type="submit" disabled={pending}>{pending ? "Checking" : "Continue"}</button>
      {state.error && <p className="notice err" role="alert">{state.error}</p>}
    </form>
  );
}

export function RegisterForm() {
  const [state, action, pending] = useActionState(registerAction, {});
  if (state.sent && state.email) return <CodeForm email={state.email} />;
  return (
    <form action={action} className="stack">
      <label>
        Name
        <input type="text" name="name" autoComplete="name" required maxLength={120} />
      </label>
      <label>
        Organisation
        <input type="text" name="organisation" autoComplete="organization" required maxLength={160} />
      </label>
      <label>
        Work email
        <input type="email" name="email" autoComplete="email" required maxLength={254} />
      </label>
      <button type="submit" disabled={pending}>{pending ? "Sending" : "Register"}</button>
      {state.error && <p className="notice err" role="alert">{state.error}</p>}
    </form>
  );
}

export function SignInForm() {
  const [state, action, pending] = useActionState(signInAction, {});
  if (state.sent && state.email) return <CodeForm email={state.email} />;
  return (
    <form action={action} className="stack">
      <label>
        Email
        <input type="email" name="email" autoComplete="email" required maxLength={254} />
      </label>
      <button type="submit" disabled={pending}>{pending ? "Sending" : "Send me a code"}</button>
      {state.error && <p className="notice err" role="alert">{state.error}</p>}
    </form>
  );
}
