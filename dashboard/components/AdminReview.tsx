"use client";

import { useState, useTransition } from "react";
import { adminSaveFields, adminApprove, adminReject, adminReopen, type Result } from "@/app/platform-actions";
import {
  FIELD_LABELS, NUMERIC_FIELDS, adminEditableFields,
  accreditationPermitsApproval, ACCREDITATION_LABEL, type Application,
} from "@/lib/db/types";
import { Result as ResultBox } from "./Result";
import { Badge } from "./ui";

const FIELD = { background: "var(--panel-2)", borderColor: "var(--line)", color: "var(--text)" } as const;
const LONG = new Set(["residentialAddress", "registeredOffice", "sourceOfFunds", "reviewerNotes"]);

export function AdminReview({ app, missing, complete }: { app: Application; missing: string[]; complete: boolean }) {
  const editable = adminEditableFields(app.accountType);
  const initial = Object.fromEntries(
    editable.map((f) => [f, (app as any)[f] == null ? "" : String((app as any)[f])]),
  );
  const [values, setValues] = useState<Record<string, string>>(initial);
  const [reason, setReason] = useState("");
  const [result, setResult] = useState<Result | null>(null);
  const [pending, start] = useTransition();

  const locked = app.status === "approved";
  const dirty = editable.some((f) => (values[f] ?? "") !== (initial[f] ?? ""));
  const accOk = accreditationPermitsApproval(app.accreditationLevel);
  const canApprove = complete && accOk && !locked && !dirty && Boolean(app.wallet);

  const act = (fn: () => Promise<Result>) => start(async () => setResult(await fn()));

  return (
    <div className="space-y-5">
      <div
        className="rounded border p-3"
        style={{
          borderColor: accOk ? "rgba(13,138,95,.3)" : "rgba(255,107,107,.3)",
          background: accOk ? "rgba(13,138,95,.04)" : "rgba(255,107,107,.05)",
        }}
      >
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[10px] uppercase tracking-wider" style={{ color: "var(--muted)" }}>Accreditation</span>
          <Badge tone={accOk ? "ok" : "bad"}>{ACCREDITATION_LABEL[app.accreditationLevel]}</Badge>
        </div>
        <p className="mt-1.5 text-xs leading-relaxed">{app.accreditationBasis ?? "Not assessed."}</p>
        {!accOk && (
          <p className="mt-1.5 text-[11px]" style={{ color: "var(--bad)" }}>
            A restricted fund cannot admit a retail investor. Approval is refused server-side, not
            merely hidden.
          </p>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {editable.map((f) => {
          const isMissing = missing.includes(f);
          const border = isMissing ? "rgba(255,107,107,.45)" : "var(--line)";
          return (
            <label key={f} className={LONG.has(f) ? "sm:col-span-2" : ""}>
              <span className="mb-1 flex items-center gap-2 text-[10px] uppercase tracking-wider" style={{ color: "var(--muted)" }}>
                {FIELD_LABELS[f] ?? f}
                {isMissing && <Badge tone="bad">required</Badge>}
              </span>
              {LONG.has(f) ? (
                <textarea rows={2} value={values[f] ?? ""} disabled={locked}
                  onChange={(e) => setValues({ ...values, [f]: e.target.value })}
                  className="w-full rounded border px-2 py-1.5 text-xs disabled:opacity-50"
                  style={{ ...FIELD, borderColor: border }} />
              ) : (
                <input value={values[f] ?? ""} disabled={locked}
                  inputMode={NUMERIC_FIELDS.has(f) ? "numeric" : undefined}
                  onChange={(e) => setValues({ ...values, [f]: e.target.value })}
                  className="w-full rounded border px-2 py-1.5 text-xs disabled:opacity-50"
                  style={{ ...FIELD, borderColor: border }} />
              )}
            </label>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t pt-4" style={{ borderColor: "var(--line)" }}>
        {!locked && (
          <button onClick={() => act(() => adminSaveFields(app.id, values))} disabled={pending || !dirty}
            className="rounded px-3 py-1.5 text-xs font-semibold uppercase tracking-wide disabled:opacity-30"
            style={{ background: "var(--accent)", color: "#fff" }}>
            {pending ? "saving…" : dirty ? "save changes" : "no changes"}
          </button>
        )}
        {!locked && (
          <button onClick={() => act(() => adminApprove(app.id))} disabled={pending || !canApprove}
            title={
              !app.wallet ? "No custody account provisioned yet"
                : dirty ? "Save your changes first"
                : !complete ? "File is incomplete"
                : !accOk ? "Retail investors cannot be admitted to a restricted fund"
                : "Sign off and grant on-chain permission"
            }
            className="rounded px-3 py-1.5 text-xs font-semibold uppercase tracking-wide disabled:opacity-30"
            style={{ background: "var(--ok)", color: "#fff" }}>
            approve &amp; grant on-chain
          </button>
        )}
        {locked && (
          <button onClick={() => act(() => adminReopen(app.id))} disabled={pending}
            className="rounded border px-3 py-1.5 text-xs uppercase tracking-wide disabled:opacity-30"
            style={{ borderColor: "var(--line)", color: "var(--muted)" }}>
            reopen for amendment
          </button>
        )}
      </div>

      {!locked && (
        <div className="flex flex-wrap items-end gap-2">
          <label className="min-w-[14rem] flex-1">
            <span className="mb-1 block text-[10px] uppercase tracking-wider" style={{ color: "var(--muted)" }}>
              Reason for declining
            </span>
            <input value={reason} onChange={(e) => setReason(e.target.value)}
              className="w-full rounded border px-2 py-1.5 text-xs" style={FIELD} />
          </label>
          <button onClick={() => act(() => adminReject(app.id, reason))} disabled={pending || !reason.trim()}
            className="rounded border px-3 py-1.5 text-xs uppercase tracking-wide disabled:opacity-30"
            style={{ borderColor: "rgba(255,107,107,.4)", color: "var(--bad)" }}>
            decline
          </button>
        </div>
      )}

      <ResultBox result={result} />

      {locked && (
        <p className="text-[11px] leading-relaxed" style={{ color: "var(--muted)" }}>
          Approved files are read-only. Reopening permits amendment but does not revoke permissions
          already granted on-chain — freeze or unregister the holder from the console for that.
        </p>
      )}
    </div>
  );
}
