import Link from "next/link";
import { trySnapshot } from "@/lib/data";
import { Panel, Stat, Badge, Mono, short, num } from "@/components/ui";
import { HoldersTable } from "@/components/HoldersTable";
import { TradePanel } from "@/components/TradePanel";
import { Controls } from "@/components/Controls";
import { Servicing } from "@/components/Servicing";
import { ResetButton } from "@/components/ResetButton";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function Page() {
  const result = await trySnapshot();

  if (!result.data) {
    return (
      <main className="mx-auto max-w-2xl p-8">
        <h1 className="text-xl font-semibold tracking-tight">Permissioned RWA console</h1>
        <div
          className="mt-5 rounded-lg border p-5"
          style={{ background: "var(--panel)", borderColor: "var(--line)" }}
        >
          <p className="text-sm" style={{ color: "var(--bad)" }}>
            Not connected to a chain
          </p>
          <p className="mt-2 text-xs leading-relaxed" style={{ color: "var(--muted)" }}>
            {result.reason}
          </p>
          <hr className="my-4" style={{ borderColor: "var(--line)" }} />
          <p className="text-xs font-medium">This deployment needs three settings</p>
          <dl className="mt-2 space-y-2 text-[11px]" style={{ color: "var(--muted)" }}>
            <div>
              <dt className="font-mono" style={{ color: "var(--text)" }}>RPC_URL</dt>
              <dd>An RPC endpoint this server can reach.</dd>
            </div>
            <div>
              <dt className="font-mono" style={{ color: "var(--text)" }}>CHAIN_ID</dt>
              <dd>The chain id behind that endpoint.</dd>
            </div>
            <div>
              <dt className="font-mono" style={{ color: "var(--text)" }}>ADDRESSES_JSON</dt>
              <dd>Contents of ops/addresses.json from the deploy.</dd>
            </div>
          </dl>
          <p className="mt-4 text-[11px] leading-relaxed" style={{ color: "var(--muted)" }}>
            Running locally? Start the chain with <span className="font-mono">./ops/reset.sh</span> and
            reload — no settings needed.
          </p>
        </div>
      </main>
    );
  }

  const s = result.data;
  const custodied = s.holders.filter((h) => h.custody !== "Self-custody");
  const aum = custodied.reduce((t, h) => t + Number(h.assetBalance), 0);

  return (
    <main className="mx-auto max-w-[1400px] space-y-4 p-5">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">{s.custody.name}</h1>
          <p className="mt-1 text-xs" style={{ color: "var(--muted)" }}>
            Permissioned RWA console — ERC-3643 asset servicing and Uniswap v4 trading
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href="/build"
            className="rounded border px-2.5 py-1 text-xs transition-opacity hover:opacity-80"
            style={{ borderColor: "var(--line)", color: "var(--accent)" }}
          >
            How it was built →
          </Link>
          {s.asset.paused ? <Badge tone="bad">asset paused</Badge> : <Badge tone="ok">asset live</Badge>}
          {s.venue.swappingEnabled ? <Badge tone="ok">trading on</Badge> : <Badge tone="warn">trading off</Badge>}
          {s.venue.enforceCountry ? <Badge tone="accent">overlay enforcing</Badge> : <Badge>overlay off</Badge>}
          <ResetButton armed={s.servicing.baselineArmed} />
        </div>
      </header>

      <div className="grid gap-4 lg:grid-cols-3">
        <Panel title="Asset" subtitle={`${s.asset.name} · ERC-3643`}>
          <div className="grid grid-cols-2 gap-4">
            <Stat label="Symbol" value={s.asset.symbol} />
            <Stat label="Total supply" value={num(s.asset.totalSupply, 0)} />
            <Stat label="In the pool adapter" value={num(s.venue.adapterAssetBalance, 0)} />
            <Stat label="Wrapped for trading" value={num(s.venue.wrappedSupply, 0)} />
          </div>
          <p className="mt-4 text-[11px] leading-relaxed" style={{ color: "var(--muted)" }}>
            The adapter is a verified holder in the issuer&apos;s registry, like any investor. It
            custodies the real asset and mints a virtual token for the pool, so the restricted
            asset never sits in Uniswap&apos;s PoolManager.
          </p>
        </Panel>

        <Panel title="Custody" subtitle={`Segregated client accounts · ${s.custody.clientCount} accounts`}>
          <div className="grid grid-cols-2 gap-4">
            <Stat label="Assets under custody" value={num(aum, 0)} />
            <Stat label="Client accounts" value={s.custody.clientCount} />
          </div>
          <dl className="mt-4 space-y-1.5 text-[11px]">
            <div className="flex justify-between gap-2">
              <dt style={{ color: "var(--muted)" }}>Operator</dt>
              <dd><Mono title={s.custody.operator}>{short(s.custody.operator)}</Mono></dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt style={{ color: "var(--muted)" }}>Account factory</dt>
              <dd><Mono title={s.custody.factory}>{short(s.custody.factory)}</Mono></dd>
            </div>
          </dl>
          <p className="mt-3 text-[11px] leading-relaxed" style={{ color: "var(--muted)" }}>
            Each client holds in its own account with its own identity, so the issuer can freeze
            or recover from one client without touching another. The custodian holds the keys;
            the client never signs.
          </p>
        </Panel>

        <Panel title="Market" subtitle={`Uniswap v4 · fee ${(s.pool.lpFee / 10000).toFixed(2)}%`}>
          <div className="grid grid-cols-2 gap-4">
            <Stat label={`Price (USDC / ${s.asset.symbol})`} value={num(s.pool.priceUsdc)} />
            <Stat label="Tick" value={s.pool.tick} />
            <Stat label="Active liquidity" value={num(Number(s.pool.liquidity) / 1e18, 2)} />
            <Stat
              label="Gate"
              value={s.venue.swappingEnabled && !s.asset.paused ? "open" : "closed"}
              tone={s.venue.swappingEnabled && !s.asset.paused ? "ok" : "bad"}
            />
          </div>
          <dl className="mt-4 space-y-1.5 text-[11px]">
            <div className="flex justify-between gap-2">
              <dt style={{ color: "var(--muted)" }}>Compliance hook</dt>
              <dd><Mono title={s.a.venue.hook}>{short(s.a.venue.hook)}</Mono></dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt style={{ color: "var(--muted)" }}>Identity bridge</dt>
              <dd><Mono title={s.a.venue.allowlistChecker}>{short(s.a.venue.allowlistChecker)}</Mono></dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt style={{ color: "var(--muted)" }}>LP requires claim topic</dt>
              <dd><Mono>{s.venue.liquidityClaimTopic}</Mono></dd>
            </div>
          </dl>
        </Panel>
      </div>

      <Panel
        title="Holders of record"
        subtitle="Permissions are read live from the issuer's identity registry, not a venue list"
      >
        <HoldersTable holders={s.holders} symbol={s.asset.symbol} />
      </Panel>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Trade" subtitle="Execute against the permissioned pool as any holder">
          <TradePanel holders={s.holders} symbol={s.asset.symbol} />
        </Panel>
        <Panel title="Controls" subtitle="Issuer and venue levers">
          <Controls
            paused={s.asset.paused}
            swappingEnabled={s.venue.swappingEnabled}
            enforceCountry={s.venue.enforceCountry}
            countries={s.venue.countries}
          />
        </Panel>
      </div>

      <Panel
        title="Asset servicing"
        subtitle="What a transfer agent does day to day — all of it on-chain, all of it attributable"
      >
        <Servicing
          holders={s.holders}
          symbol={s.asset.symbol}
          pending={s.servicing.pending}
          maxBalanceBound={s.servicing.maxBalanceBound}
        />
      </Panel>

      <footer className="pb-6 pt-2 text-[11px]" style={{ color: "var(--muted)" }}>
        Local Anvil · chain {s.a.chainId} · ERC-3643 token{" "}
        <Mono title={s.a.trex.token}>{short(s.a.trex.token)}</Mono> · identity registry{" "}
        <Mono title={s.a.trex.identityRegistry}>{short(s.a.trex.identityRegistry)}</Mono>
      </footer>
    </main>
  );
}
