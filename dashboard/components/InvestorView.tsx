"use client";

import { useState, useTransition } from "react";
import { submitMissingDetail, type PortalResult } from "@/app/portal-actions";
import { FIELD_LABELS, type Application, type EditableField } from "@/lib/db/types";
import { Result } from "./Result";
import { Badge } from "./ui";

/**
 * What the investor sees. Read-only except for whatever compliance is still waiting on, so the
 * page makes the outstanding item obvious rather than presenting a whole form to re-fill.
 */
export function InvestorView({
  app,
  missing,
  suggestion,
}: {
  app: Application;
  missing: EditableField[];
  suggestion: string;
}) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [result, setResult] = useState<PortalResult | null>(null);
  const [pending, startTransition] = useTransition();

  if (missing.length === 0) {
    return (
      <div className="text-xs leading-relaxed">
        <Badge tone="ok">nothing outstanding</Badge>
        <p className="mt-2" style={{ color: "var(--muted)" }}>
          Your file is complete. Compliance will confirm once it has been signed off.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-xs leading-relaxed" style={{ color: "var(--muted)" }}>
        We need {missing.length === 1 ? "one more detail" : `${missing.length} more details`} before
        your application can be reviewed.
      </p>

      {missing.map((f) => (
        <div key={f}>
          <label htmlFor={f} className="text-xs font-medium">
            {FIELD_LABELS[f]}
          </label>
          <div className="mt-1.5 flex flex-wrap gap-2">
            <input
              id={f}
              value={values[f] ?? ""}
              onChange={(e) => setValues({ ...values, [f]: e.target.value })}
              placeholder={f === "residentialAddress" ? suggestion : ""}
              className="min-w-[16rem] flex-1 rounded border px-2 py-1.5 text-xs"
              style={{ background: "var(--panel-2)", borderColor: "var(--line)", color: "var(--text)" }}
            />
            <button
              onClick={() =>
                startTransition(async () =>
                  setResult(await submitMissingDetail(app.id, f, values[f] ?? "")),
                )
              }
              disabled={pending || !(values[f] ?? "").trim()}
              className="rounded px-3 py-1.5 text-xs font-semibold uppercase tracking-wide disabled:opacity-30"
              style={{ background: "var(--accent)", color: "#07101f" }}
            >
              {pending ? "sending…" : "submit"}
            </button>
          </div>
          {f === "residentialAddress" && (
            <button
              onClick={() => setValues({ ...values, [f]: suggestion })}
              className="mt-1.5 text-[10px] uppercase tracking-wider transition-opacity hover:opacity-80"
              style={{ color: "var(--accent)" }}
            >
              use the address on my bank statement
            </button>
          )}
        </div>
      ))}

      <Result result={result} />
    </div>
  );
}
