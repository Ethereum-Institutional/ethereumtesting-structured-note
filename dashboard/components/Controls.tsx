"use client";

import { useState, useTransition } from "react";
import {
  setAssetPaused,
  setCountryEnforcement,
  setCountryAllowed,
  setSwappingEnabled,
  type ActionResult,
} from "@/app/actions";
import { Result } from "./Result";

function Toggle({
  label,
  hint,
  on,
  onLabel,
  offLabel,
  action,
  danger,
}: {
  label: string;
  hint: string;
  on: boolean;
  onLabel: string;
  offLabel: string;
  action: (next: boolean) => Promise<ActionResult>;
  danger?: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<ActionResult | null>(null);

  return (
    <div className="flex items-start justify-between gap-4 border-b pb-3 last:border-0 last:pb-0" style={{ borderColor: "var(--line)" }}>
      <div className="min-w-0">
        <div className="text-xs font-medium">{label}</div>
        <div className="mt-0.5 text-[11px] leading-relaxed" style={{ color: "var(--muted)" }}>
          {hint}
        </div>
        <Result result={result} />
      </div>
      <button
        onClick={() => startTransition(async () => setResult(await action(!on)))}
        disabled={pending}
        className="shrink-0 rounded border px-2.5 py-1 text-[10px] uppercase tracking-wide transition-opacity hover:opacity-80 disabled:opacity-40"
        style={{
          borderColor: on ? "rgba(53,201,138,.4)" : danger ? "rgba(255,107,107,.4)" : "var(--line)",
          color: on ? "var(--ok)" : danger ? "var(--bad)" : "var(--muted)",
        }}
      >
        {pending ? "…" : on ? onLabel : offLabel}
      </button>
    </div>
  );
}

export function Controls({
  paused,
  swappingEnabled,
  enforceCountry,
  countries,
}: {
  paused: boolean;
  swappingEnabled: boolean;
  enforceCountry: boolean;
  countries: Array<{ code: number; name: string; allowed: boolean }>;
}) {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<ActionResult | null>(null);

  return (
    <div className="space-y-3">
      <Toggle
        label="Asset paused (issuer)"
        hint="Halts every transfer and every trade, everywhere. The issuer's blunt instrument."
        on={paused}
        onLabel="paused"
        offLabel="live"
        danger
        action={(next) => setAssetPaused(next)}
      />
      <Toggle
        label="Trading enabled (adapter)"
        hint="Issuer's switch for this venue specifically. Holding and transferring continue; only pool trading stops."
        on={swappingEnabled}
        onLabel="enabled"
        offLabel="disabled"
        action={(next) => setSwappingEnabled(next)}
      />
      <Toggle
        label="Venue jurisdiction overlay"
        hint="A venue-level country gate layered on top of the issuer's own compliance module. Defence in depth."
        on={enforceCountry}
        onLabel="enforcing"
        offLabel="off"
        action={(next) => setCountryEnforcement(next)}
      />

      <div>
        <div className="text-xs font-medium">Permitted jurisdictions at the venue</div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {countries.map((c) => (
            <button
              key={c.code}
              disabled={pending}
              onClick={() => startTransition(async () => setResult(await setCountryAllowed(c.code, !c.allowed)))}
              className="rounded border px-2 py-1 text-[10px] uppercase tracking-wide transition-opacity hover:opacity-80 disabled:opacity-40"
              style={{
                borderColor: c.allowed ? "rgba(53,201,138,.4)" : "var(--line)",
                color: c.allowed ? "var(--ok)" : "var(--muted)",
                background: c.allowed ? "rgba(53,201,138,.07)" : "transparent",
              }}
            >
              {c.name}
            </button>
          ))}
        </div>
        <Result result={result} />
        {!enforceCountry && (
          <p className="mt-2 text-[11px]" style={{ color: "var(--muted)" }}>
            Overlay is off, so these have no effect yet — turn it on to enforce.
          </p>
        )}
      </div>
    </div>
  );
}
