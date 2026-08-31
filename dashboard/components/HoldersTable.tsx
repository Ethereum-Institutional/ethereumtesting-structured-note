"use client";

import { useState, useTransition } from "react";
import type { HolderRow } from "@/lib/data";
import { freezeWallet, type ActionResult } from "@/app/actions";
import { Badge, Mono, short, num } from "./ui";
import { Result } from "./Result";
import { ClaimTrigger } from "./ClaimInspector";
import { plainGate } from "@/lib/gates";

const TOPIC_LABEL: Record<number, string> = { 7: "KYC", 42: "ACCREDITED" };
const ZERO = "0x0000000000000000000000000000000000000000";

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
        <table className="w-full min-w-[760px] text-left text-xs">
          <thead>
            <tr style={{ color: "var(--muted)" }} className="text-[10px] uppercase tracking-wider">
              <th className="pb-2 pr-3 font-medium">Investor</th>
              <th className="pb-2 pr-3 font-medium">Country</th>
              <th className="pb-2 pr-3 font-medium">On-chain passport</th>
              <th className="pb-2 pr-3 text-right font-medium">Holding ({symbol})</th>
              <th className="pb-2 pr-3 font-medium">Status</th>
              <th className="pb-2 font-medium" />
            </tr>
          </thead>
          <tbody>
            {holders.map((h) => (
              <tr key={h.wallet} className="border-t" style={{ borderColor: "var(--line)" }}>
                <td className="py-2.5 pr-3">
                  <div className="flex items-center gap-1.5">
                    <span className="font-medium">{h.name}</span>
                    {h.custody !== "Self-custody" && <Badge tone="accent">custodied</Badge>}
                  </div>
                  <Mono title={h.wallet}>{short(h.wallet)}</Mono>
                </td>
                <td className="py-2.5 pr-3">{h.countryName}</td>
                <td className="py-2.5 pr-3">
                  {h.identity === ZERO ? (
                    <Badge tone="bad">not issued</Badge>
                  ) : (
                    <div>
                      {h.claims.length > 0 ? (
                        <ClaimTrigger
                          wallet={h.wallet}
                          identity={h.identity}
                          topics={h.claims}
                          style={{ textDecoration: "underline dotted", textUnderlineOffset: 3 }}
                        >
                          <Mono title={`ONCHAINID contract ${h.identity} — click to open and verify its claims`}>
                            {short(h.identity)}
                          </Mono>
                        </ClaimTrigger>
                      ) : (
                        <Mono title={`ONCHAINID contract ${h.identity}`}>{short(h.identity)}</Mono>
                      )}
                      <div className="mt-1 flex gap-1">
                        {h.claims.length === 0 ? (
                          <Badge tone="warn">no claims</Badge>
                        ) : (
                          h.claims.map((c) => (
                            <ClaimTrigger key={c} wallet={h.wallet} identity={h.identity} topics={h.claims}>
                              <Badge tone="ok">{TOPIC_LABEL[c] ?? `topic ${c}`}</Badge>
                            </ClaimTrigger>
                          ))
                        )}
                      </div>
                    </div>
                  )}
                </td>
                <td className="py-2.5 pr-3 text-right font-mono tabular-nums">{num(h.assetBalance)}</td>
                <td className="py-2.5 pr-3">
                  {h.gate === "clear" ? (
                    <span style={{ color: "var(--ok)" }}>✓ may trade</span>
                  ) : (
                    <span style={{ color: "var(--bad)" }} title={plainGate(h.gate)}>
                      {h.gate}
                    </span>
                  )}
                </td>
                <td className="py-2.5 text-right">
                  <button
                    onClick={() => toggleFreeze(h)}
                    disabled={pending && busy === h.wallet}
                    title={`${symbol}.setAddressFrozen(${short(h.wallet)}, ${!h.frozen})`}
                    className="rounded border px-2 py-1 text-[10px] uppercase tracking-wide transition-opacity hover:opacity-80 disabled:opacity-40"
                    style={{
                      borderColor: h.frozen ? "rgba(13,138,95,.4)" : "rgba(255,107,107,.4)",
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
        Freeze sends one transaction to the token; the investor&apos;s next order bounces.
      </p>
    </>
  );
}
