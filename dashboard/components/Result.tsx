"use client";
import type { ActionResult } from "@/app/actions";

export function Result({ result }: { result: ActionResult | null }) {
  if (!result) return null;
  return (
    <div
      className="mt-3 rounded border px-3 py-2 text-xs leading-relaxed"
      style={{
        borderColor: result.ok ? "rgba(9,194,255,.35)" : "rgba(255,107,107,.35)",
        background: result.ok ? "rgba(9,194,255,.08)" : "rgba(255,107,107,.08)",
        color: result.ok ? "var(--ok)" : "var(--bad)",
      }}
    >
      {result.message}
    </div>
  );
}
