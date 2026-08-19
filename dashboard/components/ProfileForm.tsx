"use client";

import { useState, useTransition } from "react";
import { updateMyProfile, submitForReview, type Result } from "@/app/platform-actions";
import { FIELD_LABELS, NUMERIC_FIELDS, type Application } from "@/lib/db/types";
import { Result as ResultBox } from "./Result";
import { Badge } from "./ui";

const FIELD = { background: "var(--panel-2)", borderColor: "var(--line)", color: "var(--text)" } as const;
const LONG = new Set(["residentialAddress", "registeredOffice", "sourceOfFunds"]);

/**
 * What the investor fills in themselves.
 *
 * Only their own declared details — screening results, subscription size and reviewer notes are
 * the platform's to set, and are not editable here.
 */
export function ProfileForm({
  app,
  editable,
  missing,
  complete,
  suggestions,
}: {
  app: Application;
  editable: string[];
  missing: string[];
  complete: boolean;
  suggestions: Record<string, string>;
}) {
  const initial = Object.fromEntries(
    editable.map((f) => [f, (app as any)[f] == null ? "" : String((app as any)[f])]),
  );
  const [values, setValues] = useState<Record<string, string>>(initial);
  const [result, setResult] = useState<Result | null>(null);
  const [pending, startTransition] = useTransition();

  const locked = app.status === "approved" || app.status === "in_review";
  const dirty = editable.some((f) => (values[f] ?? "") !== (initial[f] ?? ""));

  return (
    <div className="space-y-4">
      {locked && (
        <p className="rounded border px-3 py-2 text-[11px]"
          style={{ borderColor: "var(--line)", color: "var(--muted)" }}>
          {app.status === "approved"
            ? "Your account is approved, so these details are locked. Contact us to change anything."
            : "Your file is with compliance. You can view it, but not edit it while it is under review."}
        </p>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        {editable.map((f) => {
          const isMissing = missing.includes(f);
          const suggestion = suggestions[f];
          return (
            <label key={f} className={LONG.has(f) ? "sm:col-span-2" : ""}>
              <span className="mb-1 flex items-center gap-2 text-[10px] uppercase tracking-wider" style={{ color: "var(--muted)" }}>
                {FIELD_LABELS[f] ?? f}
                {isMissing && <Badge tone="bad">needed</Badge>}
              </span>
              <input
                value={values[f] ?? ""}
                disabled={locked}
                inputMode={NUMERIC_FIELDS.has(f) ? "numeric" : undefined}
                placeholder={suggestion ?? ""}
                onChange={(e) => setValues({ ...values, [f]: e.target.value })}
                className="w-full rounded border px-2 py-1.5 text-xs disabled:opacity-60"
                style={{ ...FIELD, borderColor: isMissing ? "rgba(255,107,107,.45)" : "var(--line)" }}
              />
              {suggestion && !locked && !(values[f] ?? "").trim() && (
                <button
                  onClick={() => setValues({ ...values, [f]: suggestion })}
                  className="mt-1 text-[10px] uppercase tracking-wider transition-opacity hover:opacity-80"
                  style={{ color: "var(--accent)" }}
                >
                  use suggested
                </button>
              )}
            </label>
          );
        })}
      </div>

      {!locked && (
        <div className="flex flex-wrap items-center gap-2 border-t pt-3" style={{ borderColor: "var(--line)" }}>
          <button
            onClick={() => startTransition(async () => setResult(await updateMyProfile(values)))}
            disabled={pending || !dirty}
            className="rounded px-3 py-1.5 text-xs font-semibold uppercase tracking-wide disabled:opacity-30"
            style={{ background: "var(--accent)", color: "#07101f" }}
          >
            {pending ? "saving…" : dirty ? "save details" : "saved"}
          </button>
          <button
            onClick={() => startTransition(async () => setResult(await submitForReview()))}
            disabled={pending || !complete || dirty}
            title={
              dirty ? "Save your changes first" : complete ? "Send for KYC review" : "Some details are still outstanding"
            }
            className="rounded px-3 py-1.5 text-xs font-semibold uppercase tracking-wide disabled:opacity-30"
            style={{ background: "var(--ok)", color: "#04140d" }}
          >
            submit for KYC review
          </button>
        </div>
      )}

      <ResultBox result={result} />
    </div>
  );
}
