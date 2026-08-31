import type { ActivityRow } from "@/lib/activity";
import { Badge, Mono } from "./ui";

const TONE = {
  control: "bad",
  trade: "accent",
  onboard: "ok",
  ops: "muted",
} as const;

export function Activity({ rows }: { rows: ActivityRow[] }) {
  if (rows.length === 0) {
    return (
      <p className="text-xs" style={{ color: "var(--muted)" }}>
        No activity yet. Anything you do in the console appears here.
      </p>
    );
  }

  return (
    <>
      <ol className="space-y-2.5">
        {rows.map((r) => (
          <li key={r.txHash} className="flex gap-3">
            <div className="w-12 shrink-0 pt-0.5 text-right">
              <Mono>#{r.block}</Mono>
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                <Badge tone={TONE[r.tone]}>{r.tone}</Badge>
                <span className="text-xs">{r.meaning}</span>
              </div>
              <div className="mt-1 overflow-x-auto">
                <code className="whitespace-nowrap text-[11px]" style={{ color: "var(--text)" }}>
                  <span style={{ color: "var(--muted)" }}>{r.target}</span>
                  <span style={{ color: "var(--muted)" }}>.</span>
                  <span style={{ color: "var(--accent)" }}>{r.fn}</span>
                  <span style={{ color: "var(--muted)" }}>(</span>
                  {r.args.map((a, i) => (
                    <span key={i}>
                      {i > 0 && <span style={{ color: "var(--muted)" }}>, </span>}
                      {a}
                    </span>
                  ))}
                  <span style={{ color: "var(--muted)" }}>)</span>
                </code>
              </div>
              <div className="mt-0.5 flex flex-wrap gap-x-3 text-[10px]" style={{ color: "var(--muted)" }}>
                <span>signed by {r.from}</span>
                {r.via && <span>via {r.via}</span>}
                <span>
                  tx <Mono title={r.txHash}>{r.txHash.slice(0, 10)}…</Mono>
                </span>
              </div>
            </div>
          </li>
        ))}
      </ol>
      <p className="mt-4 text-[11px] leading-relaxed" style={{ color: "var(--muted)" }}>
        Read from the chain&apos;s own transaction log and decoded from calldata — not an
        application log that could disagree with what actually happened. Calls the custodian made
        on a client&apos;s behalf are unwrapped to show the instruction rather than the envelope.
      </p>
    </>
  );
}
