"use client";

import { useState, useTransition } from "react";
import type { HolderRow } from "@/lib/data";
import { mintUnits, burnUnits, forceTransfer, type ActionResult } from "@/app/actions";
import { Result } from "./Result";

const FIELD = { background: "var(--panel-2)", borderColor: "var(--line)", color: "var(--text)" } as const;
const LABEL = "mb-1 block text-[10px] uppercase tracking-wider";
const BTN = "rounded px-4 py-1.5 text-xs font-semibold uppercase tracking-wide transition-opacity hover:opacity-90 disabled:opacity-40";

/** The fund desk: issue units, redeem units, recover a holding. Three verbs, one panel. */
export function IssueRedeem({ holders, symbol }: { holders: HolderRow[]; symbol: string }) {
  const [wallet, setWallet] = useState(holders[0]?.wallet ?? "");
  const [amount, setAmount] = useState("10000");
  const [to, setTo] = useState(holders[1]?.wallet ?? holders[0]?.wallet ?? "");
  const [result, setResult] = useState<ActionResult | null>(null);
  const [pending, startTransition] = useTransition();
  const [recover, setRecover] = useState(false);

  const act = (fn: () => Promise<ActionResult>) => {
    setResult(null);
    startTransition(async () => setResult(await fn()));
  };

  const holderSelect = (value: string, onChange: (v: string) => void, label: string) => (
    <label className="block">
      <span className={LABEL} style={{ color: "var(--muted)" }}>{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded border px-2 py-1.5 text-xs"
        style={FIELD}
      >
        {holders.map((h) => (
          <option key={h.wallet} value={h.wallet}>
            {h.name} — {Number(h.assetBalance).toLocaleString("en-US", { maximumFractionDigits: 0 })} {symbol}
          </option>
        ))}
      </select>
    </label>
  );

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-[1.4fr_1fr_auto_auto] sm:items-end">
        {holderSelect(wallet, setWallet, "Holder")}
        <label className="block">
          <span className={LABEL} style={{ color: "var(--muted)" }}>Units ({symbol})</span>
          <input
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="w-full rounded border px-2 py-1.5 font-mono text-xs tabular-nums"
            style={FIELD}
          />
        </label>
        <button
          onClick={() => act(() => mintUnits(wallet as `0x${string}`, amount))}
          disabled={pending}
          className={BTN}
          style={{ background: "var(--accent)", color: "#fff" }}
        >
          {pending ? "…" : "issue"}
        </button>
        <button
          onClick={() => act(() => burnUnits(wallet as `0x${string}`, amount))}
          disabled={pending}
          className={BTN}
          style={{ background: "transparent", border: "1px solid rgba(255,107,107,.5)", color: "var(--bad)" }}
        >
          {pending ? "…" : "redeem"}
        </button>
      </div>

      <button
        onClick={() => setRecover(!recover)}
        className="text-[11px] underline decoration-dotted"
        style={{ color: "var(--muted)" }}
      >
        {recover ? "hide recovery" : "recovery: force-transfer a holding →"}
      </button>

      {recover && (
        <div className="grid gap-3 rounded border p-3 sm:grid-cols-[1.4fr_1.4fr_auto] sm:items-end" style={{ borderColor: "var(--line)" }}>
          <div className="sm:col-span-3 text-[11px]" style={{ color: "var(--muted)" }}>
            Moves {amount} {symbol} from the holder selected above without their signature — the
            recovery path a regulator asks about. Uses the same amount field.
          </div>
          {holderSelect(to, setTo, "Transfer to")}
          <div />
          <button
            onClick={() => act(() => forceTransfer(wallet as `0x${string}`, to as `0x${string}`, amount))}
            disabled={pending}
            className={BTN}
            style={{ background: "var(--bad)", color: "#fff" }}
          >
            {pending ? "…" : "force transfer"}
          </button>
        </div>
      )}

      <Result result={result} />
    </div>
  );
}
