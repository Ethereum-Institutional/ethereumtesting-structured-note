import type { ReactNode } from "react";

export function Panel({
  title,
  subtitle,
  right,
  children,
}: {
  title: string;
  subtitle?: string;
  right?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section
      className="rounded-lg border"
      style={{ background: "var(--panel)", borderColor: "var(--line)" }}
    >
      <header
        className="flex items-baseline justify-between gap-4 border-b px-4 py-3"
        style={{ borderColor: "var(--line)" }}
      >
        <div>
          <h2 className="text-[13px] font-semibold uppercase tracking-wider">{title}</h2>
          {subtitle && (
            <p className="mt-0.5 text-xs" style={{ color: "var(--muted)" }}>
              {subtitle}
            </p>
          )}
        </div>
        {right}
      </header>
      <div className="p-4">{children}</div>
    </section>
  );
}

export function Stat({ label, value, tone }: { label: string; value: ReactNode; tone?: "ok" | "bad" | "warn" }) {
  const color = tone === "ok" ? "var(--ok)" : tone === "bad" ? "var(--bad)" : tone === "warn" ? "var(--warn)" : "var(--text)";
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider" style={{ color: "var(--muted)" }}>
        {label}
      </div>
      <div className="mt-1 font-mono text-lg tabular-nums" style={{ color }}>
        {value}
      </div>
    </div>
  );
}

export function Badge({ children, tone = "muted" }: { children: ReactNode; tone?: "ok" | "bad" | "warn" | "muted" | "accent" }) {
  const map = {
    ok: ["rgba(53,201,138,.13)", "var(--ok)"],
    bad: ["rgba(255,107,107,.13)", "var(--bad)"],
    warn: ["rgba(255,184,77,.13)", "var(--warn)"],
    accent: ["rgba(91,156,255,.13)", "var(--accent)"],
    muted: ["rgba(139,149,167,.12)", "var(--muted)"],
  } as const;
  const [bg, fg] = map[tone];
  return (
    <span
      className="inline-flex items-center whitespace-nowrap rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide"
      style={{ background: bg, color: fg }}
    >
      {children}
    </span>
  );
}

export function Mono({ children, title }: { children: ReactNode; title?: string }) {
  return (
    <span className="font-mono text-[11px]" style={{ color: "var(--muted)" }} title={title}>
      {children}
    </span>
  );
}

export function short(addr?: string) {
  if (!addr) return "—";
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

export function num(v: string | number, dp = 2) {
  const n = typeof v === "string" ? Number(v) : v;
  if (!Number.isFinite(n)) return String(v);
  return n.toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp });
}
