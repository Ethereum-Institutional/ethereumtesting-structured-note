"use client";

import { useState, useTransition } from "react";
import { adminAllocateUnits, adminFundCash, type Result } from "@/app/platform-actions";
import { Result as ResultBox } from "./Result";
import { Badge } from "./ui";

const FIELD = { background: "var(--panel-2)", borderColor: "var(--line)", color: "var(--text)" } as const;

/**
 * Issuing units and topping up cash, available once a file is approved.
 *
 * Deliberately separate from the file editor: locking an approved file protects the record of who
 * someone is, not the day-to-day administration of what they hold.
 */
export function HoldingsAdmin({
  id,
  symbol,
  approved,
  hasWallet,
  holding,
  cash,
  treasury,
}: {
  id: string;
  symbol: string;
  approved: boolean;
  hasWallet: boolean;
  holding: string;
  cash: string;
  treasury?: string | null;
}) {
  const [units, setUnits] = useState("50000");
  const [amount, setAmount] = useState("250000");
  const [result, setResult] = useState<Result | null>(null);
  const [pending, start] = useTransition();

  const act = (fn: () => Promise<Result>) => start(async () => setResult(await fn()));

  return (
    <div className="space-y-4">
      <dl className="flex flex-wrap gap-x-6 gap-y-1 text-xs">
        <div>
          <dt className="text-[10px] uppercase tracking-wider" style={{ color: "var(--muted)" }}>Fund units held</dt>
          <dd className="font-mono tabular-nums">{holding} {symbol}</dd>
        </div>
        <div>
          <dt className="text-[10px] uppercase tracking-wider" style={{ color: "var(--muted)" }}>Settlement cash</dt>
          <dd className="font-mono tabular-nums">{cash} USDC</dd>
        </div>
        {treasury && (
          <div>
            <dt className="text-[10px] uppercase tracking-wider" style={{ color: "var(--muted)" }}>Treasury inventory</dt>
            <dd className="font-mono tabular-nums">{treasury} {symbol}</dd>
          </div>
        )}
      </dl>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="border-t pt-3 sm:border-0 sm:pt-0" style={{ borderColor: "var(--line)" }}>
          <div className="text-xs font-medium">Issue fund units</div>
          <p className="mt-0.5 text-[11px] leading-relaxed" style={{ color: "var(--muted)" }}>
            Transfers {symbol} out of the fund&apos;s treasury into the client&apos;s custody
            account — not a fresh mint, so the inventory depletes and the asset&apos;s own transfer
            rules apply on both sides.
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <input
              value={units}
              onChange={(e) => setUnits(e.target.value)}
              className="w-32 rounded border px-2 py-1.5 font-mono text-xs tabular-nums"
              style={FIELD}
            />
            <button
              onClick={() => act(() => adminAllocateUnits(id, units))}
              disabled={pending || !approved || !hasWallet}
              title={!hasWallet ? "No custody account yet" : !approved ? "Approve the file first" : "Issue units"}
              className="rounded px-3 py-1.5 text-xs font-semibold uppercase tracking-wide disabled:opacity-30"
              style={{ background: "var(--ok)", color: "#04140d" }}
            >
              issue
            </button>
          </div>
          {!approved && <Badge tone="warn">needs approval first</Badge>}
        </div>

        <div className="border-t pt-3 sm:border-0 sm:pt-0" style={{ borderColor: "var(--line)" }}>
          <div className="text-xs font-medium">Top up settlement cash</div>
          <p className="mt-0.5 text-[11px] leading-relaxed" style={{ color: "var(--muted)" }}>
            Mints USDC so the client can keep subscribing. The stablecoin leg is unrestricted, so
            this works whatever their KYC state.
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <input
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="w-32 rounded border px-2 py-1.5 font-mono text-xs tabular-nums"
              style={FIELD}
            />
            <button
              onClick={() => act(() => adminFundCash(id, amount))}
              disabled={pending || !hasWallet}
              title={!hasWallet ? "No custody account yet" : "Fund cash"}
              className="rounded border px-3 py-1.5 text-xs uppercase tracking-wide disabled:opacity-30"
              style={{ borderColor: "rgba(91,156,255,.4)", color: "var(--accent)" }}
            >
              fund
            </button>
          </div>
        </div>
      </div>

      <ResultBox result={result} />
    </div>
  );
}
