import { ZMark } from "./Logo";

/**
 * The path every order takes, as a strip: order → Uniswap pool → OpenZeppelin hook →
 * ONCHAINID passport → outcome. The outcome node lights up with the last order's result,
 * which is what makes the hook visible as the bouncer on the door of every single trade.
 *
 * Presentational only, so it renders in server pages and inside client trade tickets alike.
 */
export function CompliancePath({
  outcome,
  reason,
}: {
  outcome?: "settled" | "rejected" | null;
  reason?: string | null;
}) {
  const chip = (label: string, sub?: string, mark?: boolean) => (
    <span
      className="inline-flex flex-col items-center rounded border px-2.5 py-1.5 text-center"
      style={{ borderColor: "var(--line)", background: "var(--panel-2)" }}
    >
      <span className="flex items-center gap-1.5 text-[11px] font-medium">
        {mark && <ZMark size={11} />}
        {label}
      </span>
      {sub && (
        <span className="text-[9px] uppercase tracking-wider" style={{ color: "var(--muted)" }}>
          {sub}
        </span>
      )}
    </span>
  );

  const arrow = (
    <span className="text-xs" style={{ color: "var(--muted)" }}>
      →
    </span>
  );

  const outcomeStyle =
    outcome === "settled"
      ? { borderColor: "rgba(13,138,95,.5)", background: "rgba(13,138,95,.06)", color: "var(--ok)" }
      : outcome === "rejected"
        ? { borderColor: "rgba(255,107,107,.5)", background: "rgba(255,107,107,.08)", color: "var(--bad)" }
        : { borderColor: "var(--line)", background: "var(--panel-2)", color: "var(--muted)" };

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        {chip("Order", "signed & sent")}
        {arrow}
        {chip("Uniswap v4 pool", "the market")}
        {arrow}
        {chip("Compliance hook", "OpenZeppelin", true)}
        {arrow}
        {chip("On-chain passport", "ONCHAINID + claims")}
        {arrow}
        <span
          className="inline-flex flex-col items-center rounded border px-2.5 py-1.5 text-center"
          style={outcomeStyle}
        >
          <span className="text-[11px] font-semibold">
            {outcome === "settled" ? "✓ Settled" : outcome === "rejected" ? "✕ Rejected" : "Settled / rejected"}
          </span>
          <span className="text-[9px] uppercase tracking-wider" style={{ color: "inherit", opacity: 0.75 }}>
            {outcome ? "last order" : "decided on-chain"}
          </span>
        </span>
      </div>
      {outcome === "rejected" && reason && (
        <p className="mt-1.5 text-[11px]" style={{ color: "var(--bad)" }}>
          {reason}.
        </p>
      )}
      <p className="mt-1.5 text-[11px] leading-relaxed" style={{ color: "var(--muted)" }}>
        Every order takes this path — the market enforces compliance itself, not this app.
      </p>
    </div>
  );
}
