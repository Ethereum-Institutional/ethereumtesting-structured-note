"use client";

import { useState, useTransition } from "react";
import {
  saveApplicationFields,
  approveApplication,
  rejectApplication,
  reopenApplication,
  moveToReview,
  type PortalResult,
} from "@/app/portal-actions";
import { EDITABLE_FIELDS, FIELD_LABELS, type Application, type EditableField } from "@/lib/db/types";
import { Result } from "./Result";
import { Badge } from "./ui";

const FIELD_STYLE = {
  background: "var(--panel-2)",
  borderColor: "var(--line)",
  color: "var(--text)",
} as const;

const LONG: EditableField[] = ["residentialAddress", "sourceOfFunds", "reviewerNotes"];

export function AdminEditor({
  app,
  missing,
  complete,
}: {
  app: Application;
  missing: EditableField[];
  complete: boolean;
}) {
  const initial = Object.fromEntries(
    EDITABLE_FIELDS.map((f) => [f, app[f as keyof Application] == null ? "" : String(app[f as keyof Application])]),
  ) as Record<EditableField, string>;

  const [values, setValues] = useState<Record<string, string>>(initial);
  const [reason, setReason] = useState("");
  const [result, setResult] = useState<PortalResult | null>(null);
  const [pending, startTransition] = useTransition();

  const dirty = EDITABLE_FIELDS.some((f) => (values[f] ?? "") !== (initial[f] ?? ""));
  const locked = app.status === "approved";

  const act = (fn: () => Promise<PortalResult>) => startTransition(async () => setResult(await fn()));

  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2">
        {EDITABLE_FIELDS.map((f) => {
          const isMissing = missing.includes(f);
          return (
            <label key={f} className={LONG.includes(f) ? "sm:col-span-2" : ""}>
              <span className="mb-1 flex items-center gap-2 text-[10px] uppercase tracking-wider" style={{ color: "var(--muted)" }}>
                {FIELD_LABELS[f]}
                {isMissing && <Badge tone="bad">required</Badge>}
              </span>
              {f === "classification" ? (
                <select
                  value={values[f] ?? "retail"}
                  disabled={locked}
                  onChange={(e) => setValues({ ...values, [f]: e.target.value })}
                  className="w-full rounded border px-2 py-1.5 text-xs disabled:opacity-50"
                  style={FIELD_STYLE}
                >
                  <option value="retail">retail — may trade only</option>
                  <option value="wholesale">wholesale — may trade and provide liquidity</option>
                </select>
              ) : LONG.includes(f) ? (
                <textarea
                  rows={2}
                  value={values[f] ?? ""}
                  disabled={locked}
                  onChange={(e) => setValues({ ...values, [f]: e.target.value })}
                  className="w-full rounded border px-2 py-1.5 text-xs disabled:opacity-50"
                  style={{
                    ...FIELD_STYLE,
                    borderColor: isMissing ? "rgba(255,107,107,.45)" : "var(--line)",
                  }}
                />
              ) : (
                <input
                  value={values[f] ?? ""}
                  disabled={locked}
                  onChange={(e) => setValues({ ...values, [f]: e.target.value })}
                  className="w-full rounded border px-2 py-1.5 text-xs disabled:opacity-50"
                  style={{
                    ...FIELD_STYLE,
                    borderColor: isMissing ? "rgba(255,107,107,.45)" : "var(--line)",
                  }}
                />
              )}
            </label>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t pt-4" style={{ borderColor: "var(--line)" }}>
        <button
          onClick={() => act(() => saveApplicationFields(app.id, values))}
          disabled={pending || !dirty || locked}
          className="rounded px-3 py-1.5 text-xs font-semibold uppercase tracking-wide disabled:opacity-30"
          style={{ background: "var(--accent)", color: "#07101f" }}
        >
          {pending ? "saving…" : dirty ? "save changes" : "no changes"}
        </button>

        {app.status === "submitted" && complete && (
          <button
            onClick={() => act(() => moveToReview(app.id))}
            disabled={pending}
            className="rounded border px-3 py-1.5 text-xs uppercase tracking-wide disabled:opacity-30"
            style={{ borderColor: "var(--line)", color: "var(--muted)" }}
          >
            move to review
          </button>
        )}

        {!locked && (
          <button
            onClick={() => act(() => approveApplication(app.id))}
            disabled={pending || !complete}
            title={complete ? "Signs off the file and grants on-chain permission" : "File is incomplete"}
            className="rounded px-3 py-1.5 text-xs font-semibold uppercase tracking-wide disabled:opacity-30"
            style={{ background: "var(--ok)", color: "#04140d" }}
          >
            approve &amp; grant on-chain
          </button>
        )}

        {locked && (
          <button
            onClick={() => act(() => reopenApplication(app.id))}
            disabled={pending}
            className="rounded border px-3 py-1.5 text-xs uppercase tracking-wide disabled:opacity-30"
            style={{ borderColor: "var(--line)", color: "var(--muted)" }}
          >
            reopen for amendment
          </button>
        )}
      </div>

      {!locked && (
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex-1">
            <span className="mb-1 block text-[10px] uppercase tracking-wider" style={{ color: "var(--muted)" }}>
              Reason for rejection
            </span>
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="w-full rounded border px-2 py-1.5 text-xs"
              style={FIELD_STYLE}
            />
          </label>
          <button
            onClick={() => act(() => rejectApplication(app.id, reason))}
            disabled={pending || !reason.trim()}
            className="rounded border px-3 py-1.5 text-xs uppercase tracking-wide disabled:opacity-30"
            style={{ borderColor: "rgba(255,107,107,.4)", color: "var(--bad)" }}
          >
            reject
          </button>
        </div>
      )}

      <Result result={result} />

      {locked && (
        <p className="text-[11px] leading-relaxed" style={{ color: "var(--muted)" }}>
          Approved files are read-only. Reopening allows amendment but does not revoke permissions
          already granted on-chain — freeze or unregister the holder from the console for that.
        </p>
      )}
    </div>
  );
}
