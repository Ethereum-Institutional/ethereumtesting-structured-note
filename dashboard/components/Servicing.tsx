"use client";

import { useState, useTransition } from "react";
import type { HolderRow } from "@/lib/data";
import {
  forceTransfer,
  setPartialFreeze,
  setMaxBalanceModule,
  completeKyc,
  type ActionResult,
} from "@/app/actions";
import { Result } from "./Result";
import { Badge } from "./ui";

const FIELD = {
  background: "var(--panel-2)",
  borderColor: "var(--line)",
  color: "var(--text)",
} as const;

const COUNTRIES = [
  { code: 702, name: "Singapore" },
  { code: 344, name: "Hong Kong" },
  { code: 392, name: "Japan" },
  { code: 36, name: "Australia" },
];

function Block({ title, hint, children }: { title: string; hint: string; children: React.ReactNode }) {
  return (
    <div className="border-b pb-4 last:border-0 last:pb-0" style={{ borderColor: "var(--line)" }}>
      <div className="text-xs font-medium">{title}</div>
      <p className="mt-0.5 text-[11px] leading-relaxed" style={{ color: "var(--muted)" }}>
        {hint}
      </p>
      <div className="mt-2">{children}</div>
    </div>
  );
}

export function Servicing({
  holders,
  symbol,
  pending,
  maxBalanceBound,
}: {
  holders: HolderRow[];
  symbol: string;
  pending: Array<{ ref: string; name: string; account: string }>;
  maxBalanceBound: boolean;
}) {
  const registered = holders.filter((h) => h.registered);

  // Live KYC onboarding
  const [kycRef, setKycRef] = useState(pending[0]?.ref ?? "");
  const [kycCountry, setKycCountry] = useState(702);
  const [kycAlloc, setKycAlloc] = useState("60000");
  const [kycRes, setKycRes] = useState<ActionResult | null>(null);
  const [kycPending, kycStart] = useTransition();

  // Forced transfer
  const [from, setFrom] = useState(registered[0]?.wallet ?? "");
  const [to, setTo] = useState(registered[1]?.wallet ?? "");
  const [amount, setAmount] = useState("1000");
  const [ftRes, setFtRes] = useState<ActionResult | null>(null);
  const [ftPending, ftStart] = useTransition();

  // Partial freeze
  const [pfWallet, setPfWallet] = useState(registered[0]?.wallet ?? "");
  const [pfAmount, setPfAmount] = useState("25000");
  const [pfRes, setPfRes] = useState<ActionResult | null>(null);
  const [pfPending, pfStart] = useTransition();

  // Concentration limit
  const [maxUnits, setMaxUnits] = useState("150000");
  const [mbRes, setMbRes] = useState<ActionResult | null>(null);
  const [mbPending, mbStart] = useTransition();

  return (
    <div className="space-y-4">
      {pending.length > 0 && (
        <Block
          title="Complete KYC for a pending client"
          hint="Mints an on-chain identity, has the trusted claim issuer attest KYC, registers the client, and allocates a holding — the full onboarding, live."
        >
          <div className="grid gap-2 sm:grid-cols-[1.4fr_1fr_1fr_auto] sm:items-end">
            <select value={kycRef} onChange={(e) => setKycRef(e.target.value)}
              className="rounded border px-2 py-1.5 text-xs" style={FIELD}>
              {pending.map((c) => (
                <option key={c.ref} value={c.ref}>{c.name}</option>
              ))}
            </select>
            <select value={kycCountry} onChange={(e) => setKycCountry(Number(e.target.value))}
              className="rounded border px-2 py-1.5 text-xs" style={FIELD}>
              {COUNTRIES.map((c) => (
                <option key={c.code} value={c.code}>{c.name}</option>
              ))}
            </select>
            <input value={kycAlloc} onChange={(e) => setKycAlloc(e.target.value)}
              className="rounded border px-2 py-1.5 font-mono text-xs tabular-nums" style={FIELD}
              placeholder={`${symbol} units`} />
            <button
              onClick={() => kycStart(async () => setKycRes(await completeKyc(kycRef, kycCountry, kycAlloc)))}
              disabled={kycPending}
              className="rounded px-3 py-1.5 text-xs font-semibold uppercase tracking-wide disabled:opacity-40"
              style={{ background: "var(--ok)", color: "#fff" }}>
              {kycPending ? "onboarding…" : "onboard"}
            </button>
          </div>
          <Result result={kycRes} />
        </Block>
      )}

      <Block
        title="Forced transfer"
        hint="Moves a holding without the holder's signature. The recovery path a regulator asks about — lost keys, a court order, a failed settlement."
      >
        <div className="grid gap-2 sm:grid-cols-[1fr_1fr_0.7fr_auto] sm:items-end">
          <select value={from} onChange={(e) => setFrom(e.target.value)}
            className="rounded border px-2 py-1.5 text-xs" style={FIELD}>
            {registered.map((h) => <option key={h.wallet} value={h.wallet}>from: {h.name}</option>)}
          </select>
          <select value={to} onChange={(e) => setTo(e.target.value)}
            className="rounded border px-2 py-1.5 text-xs" style={FIELD}>
            {registered.map((h) => <option key={h.wallet} value={h.wallet}>to: {h.name}</option>)}
          </select>
          <input value={amount} onChange={(e) => setAmount(e.target.value)}
            className="rounded border px-2 py-1.5 font-mono text-xs tabular-nums" style={FIELD} />
          <button
            onClick={() => ftStart(async () => setFtRes(await forceTransfer(from as any, to as any, amount)))}
            disabled={ftPending || from === to}
            className="rounded border px-3 py-1.5 text-xs uppercase tracking-wide disabled:opacity-40"
            style={{ borderColor: "rgba(10,116,242,.35)", color: "var(--warn)" }}>
            {ftPending ? "…" : "transfer"}
          </button>
        </div>
        <Result result={ftRes} />
      </Block>

      <Block
        title="Partial freeze"
        hint="Immobilises part of a balance while the holder keeps trading the rest — a pledged position or a disputed subscription. Used far more often than a full freeze."
      >
        <div className="grid gap-2 sm:grid-cols-[1.4fr_0.8fr_auto_auto] sm:items-end">
          <select value={pfWallet} onChange={(e) => setPfWallet(e.target.value)}
            className="rounded border px-2 py-1.5 text-xs" style={FIELD}>
            {registered.map((h) => (
              <option key={h.wallet} value={h.wallet}>
                {h.name}{Number(h.frozenTokens) > 0 ? ` — ${h.frozenTokens} frozen` : ""}
              </option>
            ))}
          </select>
          <input value={pfAmount} onChange={(e) => setPfAmount(e.target.value)}
            className="rounded border px-2 py-1.5 font-mono text-xs tabular-nums" style={FIELD} />
          <button
            onClick={() => pfStart(async () => setPfRes(await setPartialFreeze(pfWallet as any, pfAmount, true)))}
            disabled={pfPending}
            className="rounded border px-3 py-1.5 text-xs uppercase tracking-wide disabled:opacity-40"
            style={{ borderColor: "rgba(255,107,107,.4)", color: "var(--bad)" }}>
            freeze
          </button>
          <button
            onClick={() => pfStart(async () => setPfRes(await setPartialFreeze(pfWallet as any, pfAmount, false)))}
            disabled={pfPending}
            className="rounded border px-3 py-1.5 text-xs uppercase tracking-wide disabled:opacity-40"
            style={{ borderColor: "rgba(13,138,95,.4)", color: "var(--ok)" }}>
            release
          </button>
        </div>
        <Result result={pfRes} />
      </Block>

      <Block
        title="Concentration limit"
        hint="Binds a compliance module capping any single holder's balance. Modular compliance: the issuer adds a rule at runtime and it applies on the next transfer, with no redeployment."
      >
        <div className="flex flex-wrap items-end gap-2">
          <Badge tone={maxBalanceBound ? "ok" : "muted"}>
            {maxBalanceBound ? "in force" : "not bound"}
          </Badge>
          <input value={maxUnits} onChange={(e) => setMaxUnits(e.target.value)}
            className="w-32 rounded border px-2 py-1.5 font-mono text-xs tabular-nums" style={FIELD} />
          <button
            onClick={() => mbStart(async () => setMbRes(await setMaxBalanceModule(true, maxUnits)))}
            disabled={mbPending}
            className="rounded border px-3 py-1.5 text-xs uppercase tracking-wide disabled:opacity-40"
            style={{ borderColor: "rgba(78,94,228,.4)", color: "var(--accent)" }}>
            {maxBalanceBound ? "update limit" : "bind limit"}
          </button>
          {maxBalanceBound && (
            <button
              onClick={() => mbStart(async () => setMbRes(await setMaxBalanceModule(false, "0")))}
              disabled={mbPending}
              className="rounded border px-3 py-1.5 text-xs uppercase tracking-wide disabled:opacity-40"
              style={{ borderColor: "var(--line)", color: "var(--muted)" }}>
              remove
            </button>
          )}
        </div>
        <Result result={mbRes} />
      </Block>
    </div>
  );
}
