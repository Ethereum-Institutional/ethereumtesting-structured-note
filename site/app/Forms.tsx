"use client";

import { useActionState } from "react";
import { registerAction, signInAction, type FormState } from "./actions";

const SENT =
  "If the address can be used, a link has been sent to it. It is valid for 30 minutes and can be used once.";

function Result({ state }: { state: FormState }) {
  if (state.error) return <p className="notice err" role="alert">{state.error}</p>;
  if (state.sent) return <p className="notice ok" role="status">{SENT}</p>;
  return null;
}

export function RegisterForm() {
  const [state, action, pending] = useActionState(registerAction, {});
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
      <Result state={state} />
    </form>
  );
}

export function SignInForm() {
  const [state, action, pending] = useActionState(signInAction, {});
  return (
    <form action={action} className="stack">
      <label>
        Email
        <input type="email" name="email" autoComplete="email" required maxLength={254} />
      </label>
      <button type="submit" disabled={pending}>{pending ? "Sending" : "Send sign-in link"}</button>
      <Result state={state} />
    </form>
  );
}
