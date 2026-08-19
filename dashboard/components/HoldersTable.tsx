"use client";

import { useState, useTransition } from "react";
import type { HolderRow } from "@/lib/data";
import { freezeWallet, type ActionResult } from "@/app/actions";
import { Badge, Mono, short, num } from "./ui";
import { Result } from "./Result";

const TOPIC_LABEL: Record<number, string> = { 7: "KYC", 42: "PRO" };

export function HoldersTable({ holders, symbol }: { holders: HolderRow[]; symbol: string }) {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<ActionResult | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  function toggleFreeze(h: HolderRow) {
    setBusy(h.wallet);
    startTransition(async () => {
      setResult(await freezeWallet(h.wallet, !h.frozen));
      setBusy(null);
    });
  }

  return (
    <>
      <div className="-mx-4 overflow-x-auto px-4">
        <table className="w-full min-w-[980px] text-left text-xs">
          <thead>
            <tr style={{ color: "var(--muted)" }} className="text-[10px] uppercase tracking-wider">
              <th className="pb-2 pr-3 font-medium">Holder</th>
              <th className="pb-2 pr-3 font-medium">Custody</th>
              <th className="pb-2 pr-3 font-medium">Jurisdiction</th>
              <th className="pb-2 pr-3 font-medium">Claims</th>
              <th className="pb-2 pr-3 text-right font-medium">{symbol}</th>
              <th className="pb-2 pr-3 text-right font-medium">USDC</th>
              <th className="pb-2 pr-3 font-medium">Permissions</th>
              <th className="pb-2 pr-3 font-medium">Status</th>
              <th className="pb-2 font-medium" />
            </tr>
          </thead>
          <tbody>
            {holders.map((h) => (
              <tr key={h.wallet} className="border-t" style={{ borderColor: "var(--line)" }}>
                <td className="py-2.5 pr-3">
                  <div className="font-medium">{h.name}</div>
                  <Mono title={h.wallet}>{short(h.wallet)}</Mono>
                </td>
                <td className="py-2.5 pr-3">
                  {h.custody === "Self-custody" ? (
                    <Badge>self</Badge>
                  ) : (
                    <Badge tone="accent">{h.custody}</Badge>
                  )}
                </td>
                <td className="py-2.5 pr-3">{h.countryName}</td>
                <td className="py-2.5 pr-3">
                  <div className="flex gap-1">
                    {h.claims.length === 0 ? (
                      <Badge tone="bad">none</Badge>
                    ) : (
                      h.claims.map((c) => (
                        <Badge key={c} tone="muted">
                          {TOPIC_LABEL[c] ?? c}
                        </Badge>
                      ))
                    )}
                  </div>
                </td>
                <td className="py-2.5 pr-3 text-right font-mono tabular-nums">{num(h.assetBalance)}</td>
                <td className="py-2.5 pr-3 text-right font-mono tabular-nums" style={{ color: "var(--muted)" }}>
                  {num(h.cashBalance)}
                </td>
                <td className="py-2.5 pr-3">
                  <div className="flex gap-1">
                    <Badge tone={h.canSwap ? "ok" : "bad"}>swap</Badge>
                    <Badge tone={h.canProvideLiquidity ? "ok" : "bad"}>LP</Badge>
                  </div>
                </td>
                <td className="py-2.5 pr-3">
                  {h.gate === "clear" ? (
                    <span style={{ color: "var(--ok)" }}>clear</span>
                  ) : (
                    <span style={{ color: "var(--bad)" }}>{h.gate}</span>
                  )}
                </td>
                <td className="py-2.5 text-right">
                  <button
                    onClick={() => toggleFreeze(h)}
                    disabled={pending && busy === h.wallet}
                    className="rounded border px-2 py-1 text-[10px] uppercase tracking-wide transition-opacity hover:opacity-80 disabled:opacity-40"
                    style={{
                      borderColor: h.frozen ? "rgba(53,201,138,.4)" : "rgba(255,107,107,.4)",
                      color: h.frozen ? "var(--ok)" : "var(--bad)",
                    }}
                  >
                    {h.frozen ? "unfreeze" : "freeze"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Result result={result} />
      <p className="mt-3 text-[11px] leading-relaxed" style={{ color: "var(--muted)" }}>
        Freeze acts on the issuer&apos;s token via the agent role — not on the venue. Each custody
        client is an independent holder of record, so freezing one leaves its siblings trading.
      </p>
    </>
  );
}
