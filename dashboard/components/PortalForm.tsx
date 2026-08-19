"use client";

import { useState, useTransition } from "react";
import { approveInvestorApplication, type ActionResult } from "@/app/actions";
import { Result } from "./Result";
import { Badge } from "./ui";

export function PortalForm({
  suggestedAddress,
  alreadyApproved,
}: {
  suggestedAddress: string;
  alreadyApproved: boolean;
}) {
  const [address, setAddress] = useState("");
  const [checked, setChecked] = useState(false);
  const [allocation, setAllocation] = useState("75000");
  const [result, setResult] = useState<ActionResult | null>(null);
  const [pending, startTransition] = useTransition();

  const complete = address.trim().length > 8;
  const ready = complete && checked && !alreadyApproved;

  function approve() {
    setResult(null);
    startTransition(async () =>
      setResult(
        await approveInvestorApplication({ completedAddress: address.trim(), allocation }),
      ),
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <div className="flex items-baseline justify-between gap-3">
          <label className="text-xs font-medium" htmlFor="addr">
            Residential address
          </label>
          {complete ? <Badge tone="ok">supplied</Badge> : <Badge tone="bad">outstanding</Badge>}
        </div>
        <p className="mt-0.5 text-[11px]" style={{ color: "var(--muted)" }}>
          The applicant left this blank, so the file cannot be signed off. Approval stays disabled
          until it is supplied.
        </p>
        <input
          id="addr"
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          placeholder={suggestedAddress}
          disabled={alreadyApproved}
          className="mt-2 w-full rounded border px-2 py-1.5 text-xs disabled:opacity-50"
          style={{ background: "var(--panel-2)", borderColor: "var(--line)", color: "var(--text)" }}
        />
        {!complete && !alreadyApproved && (
          <button
            onClick={() => setAddress(suggestedAddress)}
            className="mt-1.5 text-[10px] uppercase tracking-wider transition-opacity hover:opacity-80"
            style={{ color: "var(--accent)" }}
          >
            use the address on file from the applicant&apos;s bank
          </button>
        )}
      </div>

      <div className="border-t pt-3" style={{ borderColor: "var(--line)" }}>
        <label className="flex cursor-pointer items-start gap-2 text-xs">
          <input
            type="checkbox"
            checked={checked}
            disabled={!complete || alreadyApproved}
            onChange={(e) => setChecked(e.target.checked)}
            className="mt-0.5"
          />
          <span>
            I confirm the file is complete, screening results are current, and this applicant meets
            the wholesale-investor test.
            <span className="mt-0.5 block text-[11px]" style={{ color: "var(--muted)" }}>
              Signing off issues two claims: KYC, and the professional-investor attestation that the
              venue requires before an account may provide liquidity.
            </span>
          </span>
        </label>
      </div>

      <div className="flex flex-wrap items-end gap-3 border-t pt-3" style={{ borderColor: "var(--line)" }}>
        <label className="block">
          <span className="mb-1 block text-[10px] uppercase tracking-wider" style={{ color: "var(--muted)" }}>
            Subscription to allocate
          </span>
          <input
            value={allocation}
            onChange={(e) => setAllocation(e.target.value)}
            disabled={alreadyApproved}
            className="w-36 rounded border px-2 py-1.5 font-mono text-xs tabular-nums disabled:opacity-50"
            style={{ background: "var(--panel-2)", borderColor: "var(--line)", color: "var(--text)" }}
          />
        </label>
        <button
          onClick={approve}
          disabled={!ready || pending}
          className="rounded px-4 py-2 text-xs font-semibold uppercase tracking-wide transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-30"
          style={{ background: "var(--ok)", color: "#04140d" }}
        >
          {alreadyApproved ? "already approved" : pending ? "approving…" : "Approve application"}
        </button>
      </div>

      <Result result={result} />
    </div>
  );
}
