import type { ReactNode } from "react";

export function Step({
  n,
  title,
  who,
  children,
}: {
  n: number;
  title: string;
  who: string;
  children: ReactNode;
}) {
  const tone =
    who === "OpenZeppelin" ? "var(--accent)" : who === "Tokeny" ? "var(--warn)" : who === "Uniswap" ? "var(--ok)" : "var(--muted)";
  return (
    <section className="relative border-l pl-6" style={{ borderColor: "var(--line)" }}>
      <div
        className="absolute -left-[13px] top-0 flex h-6 w-6 items-center justify-center rounded-full border text-[11px] font-semibold"
        style={{ background: "var(--bg)", borderColor: "var(--line)", color: "var(--muted)" }}
      >
        {n}
      </div>
      <header className="flex flex-wrap items-baseline gap-2">
        <h2 className="text-base font-semibold tracking-tight">{title}</h2>
        <span
          className="rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide"
          style={{ background: "rgba(139,149,167,.12)", color: tone }}
        >
          {who}
        </span>
      </header>
      <div className="pb-10 pt-2">{children}</div>
    </section>
  );
}

export function Proof({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div
      className="mt-3 rounded border p-3"
      style={{ borderColor: "rgba(53,201,138,.28)", background: "rgba(53,201,138,.05)" }}
    >
      <div className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: "var(--ok)" }}>
        Proof · {label}
      </div>
      <div className="mt-1.5 text-xs leading-relaxed">{children}</div>
    </div>
  );
}

export function Caveat({ children }: { children: ReactNode }) {
  return (
    <div
      className="mt-3 rounded border p-3"
      style={{ borderColor: "rgba(255,184,77,.3)", background: "rgba(255,184,77,.05)" }}
    >
      <div className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: "var(--warn)" }}>
        Be precise about this
      </div>
      <div className="mt-1.5 text-xs leading-relaxed">{children}</div>
    </div>
  );
}
