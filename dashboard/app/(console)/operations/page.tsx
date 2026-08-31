import { trySnapshot } from "@/lib/data";
import { poolAdminState } from "@/lib/pool";
import { Panel, Stat, Mono, short, num } from "@/components/ui";
import { IssueRedeem } from "@/components/IssueRedeem";
import { StackPanel } from "@/components/StackPanel";
import { PoolAdmin } from "@/components/PoolAdmin";
import { Servicing } from "@/components/Servicing";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * The fund desk: three numbers, three verbs (issue, redeem, recover). Everything an operator
 * only occasionally needs — liquidity administration, partial freezes, the contract stack —
 * lives behind one fold.
 */
export default async function OperationsPage() {
  const { data: s, reason } = await trySnapshot();
  if (!s) {
    return <p className="text-xs" style={{ color: "var(--bad)" }}>{reason}</p>;
  }
  const pool = await poolAdminState().catch(() => null);
  const custodied = s.holders.filter((h) => h.custody !== "Self-custody");
  const aum = custodied.reduce((t, h) => t + Number(h.assetBalance), 0);

  return (
    <div className="space-y-4">
      <Panel title="The fund" subtitle={`${s.asset.name} · ERC-3643 (T-REX) by Tokeny`}>
        <div className="grid grid-cols-3 gap-4">
          <Stat label={`Total supply (${s.asset.symbol})`} value={num(s.asset.totalSupply, 0)} />
          <Stat label="Assets under custody" value={num(aum, 0)} />
          <Stat label="In the trading pool" value={num(s.venue.adapterAssetBalance, 0)} />
        </div>
      </Panel>

      <Panel
        title="Issue & redeem"
        subtitle="Subscriptions mint units; redemptions burn them. The token's own compliance decides — issuing to an unverified wallet is refused on-chain."
      >
        <IssueRedeem holders={s.holders} symbol={s.asset.symbol} />
      </Panel>

      <details className="rounded-lg border" style={{ background: "var(--panel)", borderColor: "var(--line)" }}>
        <summary
          className="cursor-pointer px-4 py-3 text-[13px] font-semibold uppercase tracking-wider"
          style={{ color: "var(--muted)" }}
        >
          Advanced — liquidity, servicing, contract stack
        </summary>
        <div className="space-y-4 border-t p-4" style={{ borderColor: "var(--line)" }}>
          {pool && (
            <Panel title="Pool administration" subtitle="Fixed parameters, live market, standing liquidity">
              <PoolAdmin pool={pool} symbol={s.asset.symbol} />
            </Panel>
          )}

          <Panel title="Asset servicing" subtitle="Partial freezes, live onboarding, concentration limits">
            <Servicing
              holders={s.holders}
              symbol={s.asset.symbol}
              pending={s.servicing.pending}
              maxBalanceBound={s.servicing.maxBalanceBound}
            />
          </Panel>

          <StackPanel a={s.a} />

          <div className="space-y-1 text-[11px]" style={{ color: "var(--muted)" }}>
            <p>
              Custody operator <Mono title={s.custody.operator}>{short(s.custody.operator)}</Mono> ·
              account factory <Mono title={s.custody.factory}>{short(s.custody.factory)}</Mono> ·{" "}
              {s.custody.clientCount} client accounts
            </p>
            <p>
              Execution: Uniswap v4 · PoolManager <Mono title={s.a.venue.poolManager}>{short(s.a.venue.poolManager)}</Mono> ·
              hook <Mono title={s.a.venue.hook}>{short(s.a.venue.hook)}</Mono>
            </p>
            <p>
              Asset: token <Mono title={s.a.trex.token}>{short(s.a.trex.token)}</Mono> · identity registry{" "}
              <Mono title={s.a.trex.identityRegistry}>{short(s.a.trex.identityRegistry)}</Mono>
            </p>
          </div>
        </div>
      </details>
    </div>
  );
}
