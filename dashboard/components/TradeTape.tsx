import type { OrderRecord } from "@/lib/orders";
import { Badge, Mono } from "./ui";

/**
 * The live trade tape: every order placed this session, settled or rejected, newest first.
 * Settled rows carry the transaction hash that proves them on-chain; rejected rows carry the
 * gate that stopped them — a rejection never mines, so this is the one place it stays visible.
 */
export function TradeTape({ orders }: { orders: OrderRecord[] }) {
  if (orders.length === 0) {
    return (
      <p className="text-xs" style={{ color: "var(--muted)" }}>
        No orders yet this session. Place one from the trade ticket here or from an investor&apos;s
        screen — settled or rejected, it prints here within seconds.
      </p>
    );
  }

  return (
    <ol className="space-y-1.5">
      {orders.map((o) => (
        <li
          key={o.id}
          className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1 border-b pb-1.5 text-xs last:border-0 last:pb-0"
          style={{ borderColor: "var(--line)" }}
        >
          <Mono>{new Date(o.at).toLocaleTimeString("en-US", { hour12: false })}</Mono>
          <span className="font-medium">{o.who}</span>
          <Badge tone={o.direction === "buy" ? "ok" : "warn"}>{o.direction}</Badge>
          <span className="font-mono tabular-nums">
            {o.amountIn} {o.inSymbol}
            {o.ok && o.received ? ` → ${o.received} ${o.outSymbol}` : ""}
          </span>
          {o.ok ? (
            <span className="flex items-baseline gap-1.5">
              <Badge tone="ok">settled</Badge>
              {o.txHash && <Mono title={o.txHash}>tx {o.txHash.slice(0, 10)}…</Mono>}
            </span>
          ) : (
            <span className="flex items-baseline gap-1.5">
              <Badge tone="bad">rejected</Badge>
              <span style={{ color: "var(--bad)" }}>{o.reason}</span>
            </span>
          )}
        </li>
      ))}
    </ol>
  );
}
