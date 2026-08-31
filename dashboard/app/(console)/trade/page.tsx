import { trySnapshot } from "@/lib/data";
import { Panel, num } from "@/components/ui";
import { TradePanel } from "@/components/TradePanel";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/** One trade ticket. Settled or rejected, the order prints on the Market tab's tape. */
export default async function TradePage() {
  const { data: s, reason } = await trySnapshot();
  if (!s) {
    return <p className="text-xs" style={{ color: "var(--bad)" }}>{reason}</p>;
  }
  return (
    <div data-tour="trade">
      <Panel
        title="Trade"
        subtitle="Execute against the pool as any holder — it prints on the Market tape either way"
        right={
          <span className="text-xs" style={{ color: "var(--muted)" }}>
            live price{" "}
            <span className="font-mono" style={{ color: "var(--text)" }}>{num(s.pool.priceUsdc)} USDC</span> / {s.asset.symbol}
          </span>
        }
      >
        <TradePanel holders={s.holders} symbol={s.asset.symbol} />
      </Panel>
    </div>
  );
}
