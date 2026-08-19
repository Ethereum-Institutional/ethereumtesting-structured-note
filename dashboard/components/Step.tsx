import type { ReactNode } from "react";

/** Which party in the stack owns a step. Tones come from the Z mark palette. */
const OWNER_TONE: Record<string, string> = {
  OpenZeppelin: "var(--oz-violet)",
  Uniswap: "var(--oz-cyan)",
  Tokeny: "var(--oz-blue)",
};

export function Step({
  n,
  title,
  who,
  lede,
  children,
}: {
  n: number;
  title: string;
  who: string;
  lede?: string;
  children: ReactNode;
}) {
  const tone = OWNER_TONE[who] ?? "var(--muted)";
  return (
    <section className="relative border-l pl-6 sm:pl-8" style={{ borderColor: "var(--line)" }}>
      <div
        className="absolute -left-[14px] top-0 flex h-7 w-7 items-center justify-center rounded-full border text-[11px] font-bold"
        style={{ background: "var(--bg)", borderColor: tone, color: tone }}
      >
        {n}
      </div>
      <header className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
        <span
          className="rounded px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider"
          style={{ background: "rgba(255,255,255,.08)", color: tone }}
        >
          {who}
        </span>
      </header>
      {lede && (
        <p className="mt-2 text-sm leading-relaxed" style={{ color: "var(--muted)" }}>
          {lede}
        </p>
      )}
      <div className="pb-12 pt-3">{children}</div>
    </section>
  );
}

/**
 * A prompt written in plain English, shown the way it was actually typed.
 *
 * This is the point of the walkthrough: the input to each generation step is a
 * sentence, not a template. Rendering it verbatim is what makes that credible.
 */
export function Prompt({ children, label = "Prompt" }: { children: ReactNode; label?: string }) {
  return (
    <div
      className="mt-3 overflow-hidden rounded-lg border"
      style={{ borderColor: "rgba(79,86,250,.5)", background: "rgba(79,86,250,.08)" }}
    >
      <div
        className="flex items-center gap-2 border-b px-3 py-1.5"
        style={{ borderColor: "rgba(79,86,250,.28)" }}
      >
        <span className="text-[11px] font-bold" style={{ color: "var(--oz-violet)" }}>
          &rsaquo;
        </span>
        <span
          className="text-[10px] font-semibold uppercase tracking-wider"
          style={{ color: "var(--oz-violet)" }}
        >
          {label}
        </span>
      </div>
      <p className="px-3 py-2.5 text-[13px] italic leading-relaxed" style={{ color: "var(--text)" }}>
        {children}
      </p>
    </div>
  );
}

/** What the prompt resolved to: which hosted MCP server, which tool, which arguments. */
export function ToolCall({
  server,
  tool,
  params,
}: {
  server: string;
  tool: string;
  params?: unknown;
}) {
  return (
    <div
      className="mt-2 rounded-lg border"
      style={{ borderColor: "var(--line)", background: "var(--panel)" }}
    >
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 px-3 py-2">
        <span
          className="rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider"
          style={{ background: "rgba(9,194,255,.14)", color: "var(--oz-cyan)" }}
        >
          MCP call
        </span>
        <span className="font-mono text-[11px]" style={{ color: "var(--text)" }}>
          {tool}
        </span>
        <span className="font-mono text-[10px]" style={{ color: "var(--faint)" }}>
          {server}
        </span>
      </div>
      {params != null && (
        <pre
          className="overflow-x-auto border-t px-3 py-2 text-[10.5px] leading-[1.6]"
          style={{ borderColor: "var(--line)", color: "var(--muted)" }}
        >
          <code>{JSON.stringify(params, null, 2)}</code>
        </pre>
      )}
    </div>
  );
}

/** A verifiable claim, backed by something read from the running chain. */
export function Proof({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div
      className="mt-3 rounded-lg border p-3"
      style={{ borderColor: "rgba(9,194,255,.35)", background: "rgba(9,194,255,.06)" }}
    >
      <div className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: "var(--ok)" }}>
        Verified &middot; {label}
      </div>
      <div className="mt-1.5 text-xs leading-relaxed">{children}</div>
    </div>
  );
}

/** A factual clarification a reader needs in order to read the step correctly. */
export function Note({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div
      className="mt-3 rounded-lg border p-3"
      style={{ borderColor: "rgba(46,153,255,.35)", background: "rgba(46,153,255,.06)" }}
    >
      <div className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: "var(--oz-blue)" }}>
        {title}
      </div>
      <div className="mt-1.5 text-xs leading-relaxed">{children}</div>
    </div>
  );
}

/** Why a design choice matters commercially, rather than technically. */
export function Takeaway({ children }: { children: ReactNode }) {
  return (
    <div
      className="mt-3 rounded-lg border-l-2 py-1 pl-3"
      style={{ borderColor: "var(--oz-violet)" }}
    >
      <div className="text-sm leading-relaxed">{children}</div>
    </div>
  );
}
