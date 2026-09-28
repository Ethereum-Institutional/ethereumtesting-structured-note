"use client";

import { useFormStatus } from "react-dom";

/**
 * A submit button that says what is happening while its form's action runs. Some actions wait
 * on several transactions and take the better part of a minute; without this the page looks idle.
 */
export function PendingButton({ children, working, className }: { children: React.ReactNode; working: string; className?: string }) {
  const { pending } = useFormStatus();
  return (
    <>
      <button type="submit" className={className} disabled={pending} aria-busy={pending}>
        {pending ? "Working…" : children}
      </button>
      {pending && <span role="status" className="muted">{working}</span>}
    </>
  );
}
