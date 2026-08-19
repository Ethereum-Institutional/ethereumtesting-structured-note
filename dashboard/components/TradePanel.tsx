"use client";

import { useState, useTransition } from "react";
import type { HolderRow } from "@/lib/data";
import { trade, type ActionResult } from "@/app/actions";
import { Result } from "./Result";
import { Badge } from "./ui";

export function TradePanel({ holders, symbol }: { holders: HolderRow[]; symbol: string }) {
  const [actor, setActor] = useState(holders[0]?.actor ?? "");
  const [direction, setDirection] = useState<"buy" | "sell">("buy");
  const [amount, setAmount] = useState("25000");
  const [result, setResult] = useState<ActionResult | null>(null);
  const [pending, startTransition] = useTransition();

  const selected = holders.find((h) => h.actor === actor);
  const inSymbol = direction === "buy" ? "USDC" : symbol;

  function submit() {
    setResult(null);
    startTransition(async () => setResult(await trade(actor, direction, amount)));
  }

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-[1.6fr_1fr_1fr_auto] sm:items-end">
        <label className="block">
          <span className="mb-1 block text-[10px] uppercase tracking-wider" style={{ color: "var(--muted)" }}>
            Acting for
          </span>
          <select
            value={actor}
            onChange={(e) => setActor(e.target.value)}
            className="w-full rounded border px-2 py-1.5 text-xs"
            style={{ background: "var(--panel-2)", borderColor: "var(--line)", color: "var(--text)" }}
          >
            {holders.map((h) => (
              <option key={h.actor} value={h.actor}>
                {h.name} — {h.custody === "Self-custody" ? "self" : h.custody}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="mb-1 block text-[10px] uppercase tracking-wider" style={{ color: "var(--muted)" }}>
            Side
          </span>
          <select
            value={direction}
            onChange={(e) => setDirection(e.target.value as "buy" | "sell")}
            className="w-full rounded border px-2 py-1.5 text-xs"
            style={{ background: "var(--panel-2)", borderColor: "var(--line)", color: "var(--text)" }}
          >
            <option value="buy">Buy {symbol}</option>
            <option value="sell">Sell {symbol}</option>
          </select>
        </label>

        <label className="block">
          <span className="mb-1 block text-[10px] uppercase tracking-wider" style={{ color: "var(--muted)" }}>
            Amount in ({inSymbol})
          </span>
          <input
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="w-full rounded border px-2 py-1.5 font-mono text-xs tabular-nums"
            style={{ background: "var(--panel-2)", borderColor: "var(--line)", color: "var(--text)" }}
          />
        </label>

        <button
          onClick={submit}
          disabled={pending}
          className="rounded px-4 py-1.5 text-xs font-semibold uppercase tracking-wide transition-opacity hover:opacity-90 disabled:opacity-40"
          style={{ background: "var(--accent)", color: "#ffffff" }}
        >
          {pending ? "submitting…" : "swap"}
        </button>
      </div>

      {selected && (
        <div className="flex items-center gap-2 text-[11px]" style={{ color: "var(--muted)" }}>
          <span>expected:</span>
          {selected.canSwap ? (
            <Badge tone="ok">will settle</Badge>
          ) : (
            <Badge tone="bad">will be rejected — {selected.gate}</Badge>
          )}
          {selected.custody !== "Self-custody" && (
            <span>
              · signed by the custodian, evaluated against <strong>{selected.name}</strong>&apos;s identity
            </span>
          )}
        </div>
      )}

      <Result result={result} />
    </div>
  );
}
