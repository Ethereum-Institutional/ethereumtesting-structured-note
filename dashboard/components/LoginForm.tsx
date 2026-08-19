"use client";

import { useState, useTransition } from "react";
import { sendMagicLink, type Result } from "@/app/platform-actions";

const FIELD = { background: "var(--panel-2)", borderColor: "var(--line)", color: "var(--text)" } as const;

export function LoginForm() {
  const [email, setEmail] = useState("");
  const [staff, setStaff] = useState(false);
  const [code, setCode] = useState("");
  const [result, setResult] = useState<Result | null>(null);
  const [pending, startTransition] = useTransition();

  function submit() {
    setResult(null);
    startTransition(async () =>
      setResult(await sendMagicLink(email, window.location.origin, staff ? code : undefined)),
    );
  }

  const link = result?.ok ? result.data?.url : null;

  return (
    <div className="space-y-4">
      <label className="block">
        <span className="mb-1 block text-[10px] uppercase tracking-wider" style={{ color: "var(--muted)" }}>
          Email address
        </span>
        <input
          type="email"
          value={email}
          autoComplete="email"
          onChange={(e) => setEmail(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && email && submit()}
          placeholder="you@yourbank.com"
          className="w-full rounded border px-3 py-2 text-sm"
          style={FIELD}
        />
      </label>

      <div>
        <label className="flex cursor-pointer items-center gap-2 text-[11px]" style={{ color: "var(--muted)" }}>
          <input type="checkbox" checked={staff} onChange={(e) => setStaff(e.target.checked)} />
          I am compliance staff
        </label>
        {staff && (
          <input
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="staff access code"
            className="mt-2 w-full rounded border px-3 py-2 text-sm"
            style={FIELD}
          />
        )}
      </div>

      <button
        onClick={submit}
        disabled={pending || !email.trim()}
        className="w-full rounded px-4 py-2.5 text-sm font-semibold uppercase tracking-wide transition-opacity hover:opacity-90 disabled:opacity-30"
        style={{ background: "var(--accent)", color: "#07101f" }}
      >
        {pending ? "preparing…" : "Send me a sign-in link"}
      </button>

      {result && !result.ok && (
        <p className="rounded border px-3 py-2 text-xs"
          style={{ borderColor: "rgba(255,107,107,.35)", background: "rgba(255,107,107,.07)", color: "var(--bad)" }}>
          {result.message}
        </p>
      )}

      {link && (
        <div className="rounded border px-3 py-3"
          style={{ borderColor: "rgba(53,201,138,.35)", background: "rgba(53,201,138,.07)" }}>
          <p className="text-xs" style={{ color: "var(--ok)" }}>{result?.message}</p>
          <a
            href={link}
            className="mt-2 inline-block rounded px-4 py-2 text-xs font-semibold uppercase tracking-wide"
            style={{ background: "var(--ok)", color: "#04140d" }}
          >
            Sign in now →
          </a>
          <p className="mt-2 text-[10px] leading-relaxed" style={{ color: "var(--muted)" }}>
            Valid once, for 20 minutes. Shown here rather than emailed because this demo has no
            mail provider configured.
          </p>
        </div>
      )}
    </div>
  );
}
