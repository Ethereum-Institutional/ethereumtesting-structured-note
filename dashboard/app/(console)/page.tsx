import { marketState } from "@/lib/data";
import { recentOrders } from "@/lib/orders";
import { Panel, Stat, Badge, num } from "@/components/ui";
import { TradeTape } from "@/components/TradeTape";
import { CompliancePath } from "@/components/CompliancePath";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/** The market, and nothing else: price, real depth, the path every order takes, the tape. */
export default async function MarketPage() {
  const [m, orders] = await Promise.all([marketState(), recentOrders()]);
  const lastOrder = orders[0] ?? null;
  const open = m.swappingEnabled && !m.paused;

  return (
    <div className="space-y-4" data-tour="market">
      <Panel
        title="Live market"
        subtitle={`Uniswap v4 permissioned pool · fee ${(m.lpFee / 10000).toFixed(2)}% · read from the chain every 6s`}
        right={open ? <Badge tone="ok">market open</Badge> : <Badge tone="bad">market closed</Badge>}
      >
        <div className="grid grid-cols-3 gap-4">
          <Stat label={`Price (USDC / ${m.symbol})`} value={num(m.priceUsdc)} />
          <Stat label={`Pool depth (${m.symbol})`} value={num(m.depthAsset, 0)} />
          <Stat label="Pool depth (USDC)" value={num(m.depthCash, 0)} />
        </div>
        <div className="mt-5 border-t pt-4" style={{ borderColor: "var(--line)" }}>
          <CompliancePath
            outcome={lastOrder ? (lastOrder.ok ? "settled" : "rejected") : null}
            reason={lastOrder && !lastOrder.ok ? lastOrder.reason : null}
          />
        </div>
      </Panel>

      <Panel title="Trade tape" subtitle="Every order this session — settled and rejected">
        <TradeTape orders={orders} />
      </Panel>
    </div>
  );
}
