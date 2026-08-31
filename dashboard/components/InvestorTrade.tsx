"use client";

import { useState, useTransition } from "react";
import { tradeForMyAccount, type Result } from "@/app/platform-actions";
import { Result as ResultBox } from "./Result";
import { CompliancePath } from "./CompliancePath";

const FIELD = { background: "var(--panel-2)", borderColor: "var(--line)", color: "var(--text)" } as const;

export function InvestorTrade({ symbol, cash, holding }: { symbol: string; cash: string; holding: string }) {
  const [direction, setDirection] = useState<"buy" | "sell">("buy");
  const [amount, setAmount] = useState("25000");
  const [result, setResult] = useState<Result | null>(null);
  const [pending, startTransition] = useTransition();

  const inSymbol = direction === "buy" ? "USDC" : symbol;
  const available = direction === "buy" ? cash : holding;
  const outcome = (result?.data?.outcome ?? null) as "settled" | "rejected" | null;

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
        <label className="block">
          <span className="mb-1 block text-[10px] uppercase tracking-wider" style={{ color: "var(--muted)" }}>
            Order
          </span>
          <select
            value={direction}
            onChange={(e) => setDirection(e.target.value as "buy" | "sell")}
            className="w-full rounded border px-2 py-1.5 text-xs"
            style={FIELD}
          >
            <option value="buy">Subscribe — buy {symbol}</option>
            <option value="sell">Redeem — sell {symbol}</option>
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-[10px] uppercase tracking-wider" style={{ color: "var(--muted)" }}>
            Amount ({inSymbol}) · available {available}
          </span>
          <input
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="w-full rounded border px-2 py-1.5 font-mono text-xs tabular-nums"
            style={FIELD}
          />
        </label>
        <button
          onClick={() => startTransition(async () => setResult(await tradeForMyAccount(direction, amount)))}
          disabled={pending}
          className="rounded px-4 py-1.5 text-xs font-semibold uppercase tracking-wide disabled:opacity-30"
          style={{ background: "var(--accent)", color: "#fff" }}
        >
          {pending ? "placing…" : "place order"}
        </button>
      </div>
      <CompliancePath outcome={pending ? null : outcome} reason={result?.data?.reason ?? null} />
      <ResultBox result={result} />
    </div>
  );
}
