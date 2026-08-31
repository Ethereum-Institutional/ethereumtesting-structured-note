"use client";

import { useState, useTransition } from "react";
import { addTreasuryLiquidity, unwindLpPosition, type ActionResult } from "@/app/actions";
import type { PoolAdminState } from "@/lib/pool";
import { Result } from "./Result";
import { Badge, Mono, short, num } from "./ui";

const FIELD = { background: "var(--panel-2)", borderColor: "var(--line)", color: "var(--text)" } as const;

export function PoolAdmin({ pool, symbol }: { pool: PoolAdminState; symbol: string }) {
  const [units, setUnits] = useState("100000");
  const [cash, setCash] = useState("10000000");
  const [result, setResult] = useState<ActionResult | null>(null);
  const [pending, start] = useTransition();
  const act = (fn: () => Promise<ActionResult>) => start(async () => setResult(await fn()));

  return (
    <div className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <div className="text-[10px] uppercase tracking-wider" style={{ color: "var(--muted)" }}>
            Fixed at pool creation — changing any of these means a new pool
          </div>
          <dl className="mt-1.5 space-y-1 text-xs">
            <div className="flex justify-between gap-2">
              <dt style={{ color: "var(--muted)" }}>Trading fee (to LPs)</dt>
              <dd><Mono>{(pool.fee / 10000).toFixed(2)}%</Mono></dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt style={{ color: "var(--muted)" }}>Tick spacing</dt>
              <dd><Mono>{pool.tickSpacing}</Mono></dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt style={{ color: "var(--muted)" }}>Compliance hook</dt>
              <dd><Mono title={pool.hook}>{short(pool.hook)}</Mono></dd>
            </div>
          </dl>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wider" style={{ color: "var(--muted)" }}>
            Live market
          </div>
          <dl className="mt-1.5 space-y-1 text-xs">
            <div className="flex justify-between gap-2">
              <dt style={{ color: "var(--muted)" }}>Price</dt>
              <dd><Mono>{num(pool.priceUsdc)} USDC / {symbol}</Mono></dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt style={{ color: "var(--muted)" }}>Active liquidity</dt>
              <dd><Mono>{num(pool.activeLiquidity, 2)}</Mono></dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt style={{ color: "var(--muted)" }}>Trading</dt>
              <dd><Badge tone={pool.swappingEnabled ? "ok" : "bad"}>{pool.swappingEnabled ? "enabled" : "disabled"}</Badge></dd>
            </div>
          </dl>
        </div>
      </div>

      <p className="rounded border p-3 text-[11px] leading-relaxed" style={{ borderColor: "var(--line)", color: "var(--muted)" }}>
        There is no order book: this is an AMM. Standing liquidity plays the role a book plays on an
        exchange — the price moves along the curve as swaps consume it, and the fee accrues to
        whoever supplied the liquidity. Runtime control lives on the adapter and the compliance
        bridge (the Controls panel above): who may trade, who may provide liquidity, which routers
        are approved, and whether trading is on at all.
      </p>

      <div className="border-t pt-4" style={{ borderColor: "var(--line)" }}>
        <div className="text-xs font-medium">Standing liquidity</div>
        <div className="-mx-4 mt-2 overflow-x-auto px-4">
          <table className="w-full min-w-[480px] text-left text-xs">
            <thead>
              <tr className="text-[10px] uppercase tracking-wider" style={{ color: "var(--muted)" }}>
                <th className="pb-1.5 pr-3 font-medium">Position</th>
                <th className="pb-1.5 pr-3 font-medium">Provider</th>
                <th className="pb-1.5 pr-3 text-right font-medium">Liquidity</th>
                <th className="pb-1.5 font-medium" />
              </tr>
            </thead>
            <tbody>
              {pool.positions.map((p) => (
                <tr key={p.tokenId} className="border-t" style={{ borderColor: "var(--line)" }}>
                  <td className="py-2 pr-3"><Mono>#{p.tokenId}</Mono></td>
                  <td className="py-2 pr-3">
                    {p.ownerLabel} <Mono title={p.owner}>{short(p.owner)}</Mono>
                  </td>
                  <td className="py-2 pr-3 text-right font-mono tabular-nums">{num(p.liquidity, 2)}</td>
                  <td className="py-2 text-right">
                    {p.active && (
                      <button
                        onClick={() => act(() => unwindLpPosition(String(p.tokenId)))}
                        disabled={pending}
                        title="Force-exit this LP: burns the position and returns both legs to them"
                        className="rounded border px-2 py-1 text-[10px] uppercase tracking-wide disabled:opacity-40"
                        style={{ borderColor: "rgba(255,107,107,.4)", color: "var(--bad)" }}
                      >
                        unwind
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {pool.positions.length === 0 && (
                <tr><td colSpan={4} className="py-2 text-xs" style={{ color: "var(--muted)" }}>No positions.</td></tr>
              )}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-[11px] leading-relaxed" style={{ color: "var(--muted)" }}>
          Position NFTs in a permissioned pool are non-transferable, and the issuer can force-exit
          any provider — so an LP whose permission is revoked cannot keep earning fees or hand the
          position to someone else.
        </p>
      </div>

      <div className="border-t pt-4" style={{ borderColor: "var(--line)" }}>
        <div className="text-xs font-medium">Deploy treasury liquidity</div>
        <p className="mt-0.5 text-[11px] leading-relaxed" style={{ color: "var(--muted)" }}>
          Puts treasury inventory to work as standing liquidity, earning the pool fee. Treasury
          holds <Mono>{num(pool.treasuryUnits, 0)} {symbol}</Mono> and{" "}
          <Mono>{num(pool.treasuryCash, 0)} USDC</Mono>; cash is topped up automatically if the
          plan needs more. The hook checks the treasury&apos;s own LP permission — the fund is
          subject to the same gate as anyone.
        </p>
        <div className="mt-2 flex flex-wrap items-end gap-2">
          <label>
            <span className="mb-1 block text-[10px] uppercase tracking-wider" style={{ color: "var(--muted)" }}>{symbol} units</span>
            <input value={units} onChange={(e) => setUnits(e.target.value)}
              className="w-36 rounded border px-2 py-1.5 font-mono text-xs tabular-nums" style={FIELD} />
          </label>
          <label>
            <span className="mb-1 block text-[10px] uppercase tracking-wider" style={{ color: "var(--muted)" }}>USDC</span>
            <input value={cash} onChange={(e) => setCash(e.target.value)}
              className="w-36 rounded border px-2 py-1.5 font-mono text-xs tabular-nums" style={FIELD} />
          </label>
          <button
            onClick={() => act(() => addTreasuryLiquidity(units, cash))}
            disabled={pending}
            className="rounded px-3 py-1.5 text-xs font-semibold uppercase tracking-wide disabled:opacity-30"
            style={{ background: "var(--accent)", color: "#fff" }}
          >
            {pending ? "deploying…" : "deploy liquidity"}
          </button>
        </div>
        <p className="mt-1.5 text-[10px]" style={{ color: "var(--muted)" }}>
          At the 100 USDC opening price, balanced liquidity wants roughly 100&times; more USDC than units.
        </p>
      </div>

      <Result result={result} />
    </div>
  );
}
