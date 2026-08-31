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
import { short } from "./ui";

/** Contract identities the previews name, passed from the server page. */
export type ControlContracts = {
  token: string;
  checker: string;
  adapter: string;
  symbol: string;
};

/** The exact Solidity call the next click sends — shown before anything happens. */
function CallPreview({ contract, address, call }: { contract: string; address: string; call: string }) {
  return (
    <div
      className="mt-1.5 overflow-x-auto whitespace-nowrap rounded border px-2 py-1 font-mono text-[10px]"
      style={{ borderColor: "var(--line)", background: "var(--panel-2)", color: "var(--muted)" }}
    >
      <span className="uppercase tracking-wider">next click → </span>
      <span style={{ color: "var(--text)" }}>{contract}</span>
      <span title={address}> ({short(address)})</span>
      <span style={{ color: "var(--accent)" }}>.{call}</span>
    </div>
  );
}

function Toggle({
  label,
  hint,
  on,
  onLabel,
  offLabel,
  action,
  danger,
  preview,
}: {
  label: string;
  hint: string;
  on: boolean;
  onLabel: string;
  offLabel: string;
  action: (next: boolean) => Promise<ActionResult>;
  danger?: boolean;
  preview: { contract: string; address: string; call: string };
}) {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<ActionResult | null>(null);

  return (
    <div className="flex items-start justify-between gap-4 border-b pb-3 last:border-0 last:pb-0" style={{ borderColor: "var(--line)" }}>
      <div className="min-w-0 flex-1">
        <div className="text-xs font-medium">{label}</div>
        <div className="mt-0.5 text-[11px] leading-relaxed" style={{ color: "var(--muted)" }}>
          {hint}
        </div>
        <CallPreview {...preview} />
        <Result result={result} />
      </div>
      <button
        onClick={() => startTransition(async () => setResult(await action(!on)))}
        disabled={pending}
        className="shrink-0 rounded border px-2.5 py-1 text-[10px] uppercase tracking-wide transition-opacity hover:opacity-80 disabled:opacity-40"
        style={{
          borderColor: on ? "rgba(13,138,95,.4)" : danger ? "rgba(255,107,107,.4)" : "var(--line)",
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
  contracts,
}: {
  paused: boolean;
  swappingEnabled: boolean;
  enforceCountry: boolean;
  countries: Array<{ code: number; name: string; allowed: boolean }>;
  contracts: ControlContracts;
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
        preview={{
          contract: `${contracts.symbol} token`,
          address: contracts.token,
          call: `${paused ? "unpause" : "pause"}()`,
        }}
      />
      <Toggle
        label="Trading enabled (adapter)"
        hint="Issuer's switch for this venue specifically. Holding and transferring continue; only pool trading stops."
        on={swappingEnabled}
        onLabel="enabled"
        offLabel="disabled"
        action={(next) => setSwappingEnabled(next)}
        preview={{
          contract: "PermissionsAdapter",
          address: contracts.adapter,
          call: `updateSwappingEnabled(${!swappingEnabled})`,
        }}
      />
      <Toggle
        label="Venue jurisdiction overlay"
        hint="A venue-level country gate layered on top of the issuer's own compliance module. Defence in depth."
        on={enforceCountry}
        onLabel="enforcing"
        offLabel="off"
        action={(next) => setCountryEnforcement(next)}
        preview={{
          contract: "AllowlistChecker",
          address: contracts.checker,
          call: `setCountryEnforcement(${contracts.symbol}, ${!enforceCountry})`,
        }}
      />

      <div>
        <div className="text-xs font-medium">Permitted jurisdictions at the venue</div>
        <p className="mt-0.5 text-[11px] leading-relaxed" style={{ color: "var(--muted)" }}>
          Each chip flips one storage slot on the AllowlistChecker contract — click one and watch
          the receipt below, then the ledger. Blocking a country switches the overlay on
          automatically, so the block always bites.
        </p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {countries.map((c) => (
            <button
              key={c.code}
              disabled={pending}
              onClick={() => startTransition(async () => setResult(await setCountryAllowed(c.code, !c.allowed)))}
              title={`AllowlistChecker.setCountryAllowed(${contracts.symbol}, ${c.code}, ${!c.allowed})`}
              className="rounded border px-2 py-1 text-[10px] uppercase tracking-wide transition-opacity hover:opacity-80 disabled:opacity-40"
              style={{
                borderColor: c.allowed ? "rgba(13,138,95,.4)" : "var(--line)",
                color: c.allowed ? "var(--ok)" : "var(--muted)",
                background: c.allowed ? "rgba(13,138,95,.05)" : "transparent",
              }}
            >
              {c.name} · {c.code}
            </button>
          ))}
        </div>
        <CallPreview
          contract="AllowlistChecker"
          address={contracts.checker}
          call={`setCountryAllowed(${contracts.symbol}, <ISO code>, <allowed>)`}
        />
        <Result result={result} />
        {!enforceCountry && (
          <p className="mt-2 rounded border px-2.5 py-1.5 text-[11px]" style={{ borderColor: "rgba(10,116,242,.3)", color: "var(--warn)" }}>
            Overlay is currently off — allowed/blocked flags are not being enforced. Blocking any
            country turns it on automatically.
          </p>
        )}
      </div>
    </div>
  );
}
