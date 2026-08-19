"use client";
import { useTransition } from "react";
import { signOutAction } from "@/app/platform-actions";

export function SignOutButton() {
  const [pending, start] = useTransition();
  return (
    <button
      onClick={() => start(async () => { await signOutAction(); window.location.href = "/login"; })}
      disabled={pending}
      className="rounded border px-2 py-0.5 text-[10px] uppercase tracking-wider transition-opacity hover:opacity-80 disabled:opacity-40"
      style={{ borderColor: "var(--line)", color: "var(--muted)" }}
    >
      {pending ? "…" : "sign out"}
    </button>
  );
}
