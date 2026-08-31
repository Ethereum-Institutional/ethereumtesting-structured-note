"use client";

import { useState, useTransition } from "react";
import { resetDemo, type ActionResult } from "@/app/actions";
import { Result } from "./Result";

export function ResetButton({ armed }: { armed: boolean }) {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<ActionResult | null>(null);
  const [confirming, setConfirming] = useState(false);

  function go() {
    setConfirming(false);
    setResult(null);
    startTransition(async () => setResult(await resetDemo()));
  }

  return (
    <div className="relative">
      {confirming ? (
        <span className="flex items-center gap-1.5">
          <button
            onClick={go}
            className="rounded px-2.5 py-1 text-xs font-semibold uppercase tracking-wide"
            style={{ background: "var(--bad)", color: "#fff" }}
          >
            confirm reset
          </button>
          <button
            onClick={() => setConfirming(false)}
            className="rounded border px-2 py-1 text-xs"
            style={{ borderColor: "var(--line)", color: "var(--muted)" }}
          >
            cancel
          </button>
        </span>
      ) : (
        <button
          onClick={() => (armed ? setConfirming(true) : go())}
          disabled={pending}
          title={
            armed
              ? "Reverts the chain to the armed baseline"
              : "No baseline armed yet — this captures one at the current state"
          }
          className="rounded border px-2.5 py-1 text-xs transition-opacity hover:opacity-80 disabled:opacity-40"
          style={{ borderColor: "var(--line)", color: armed ? "var(--warn)" : "var(--muted)" }}
        >
          {pending ? "working…" : armed ? "Reset demo" : "Arm baseline"}
        </button>
      )}
      {result && (
        // Solid background: the Result box's own tint is translucent, which is fine inside a
        // panel but unreadable floating over page content.
        <div
          className="absolute right-0 top-9 z-20 w-80 rounded-lg border p-1"
          style={{ background: "var(--bg)", borderColor: "var(--line)", boxShadow: "0 10px 36px rgba(40,40,70,.18)" }}
          onClick={() => setResult(null)}
          title="Click to dismiss"
        >
          <Result result={result} />
        </div>
      )}
    </div>
  );
}
