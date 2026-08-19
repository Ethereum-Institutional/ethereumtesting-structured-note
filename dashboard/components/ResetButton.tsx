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
            style={{ background: "var(--bad)", color: "#160707" }}
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
        <div className="absolute right-0 top-9 z-10 w-80">
          <Result result={result} />
        </div>
      )}
    </div>
  );
}
