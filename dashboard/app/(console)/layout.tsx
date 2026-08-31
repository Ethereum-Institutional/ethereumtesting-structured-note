import Link from "next/link";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { currentUser } from "@/lib/auth";
import { tryStatusStrip } from "@/lib/data";
import { Badge } from "@/components/ui";
import { NavTabs } from "@/components/NavTabs";
import { ResetButton } from "@/components/ResetButton";
import { SignOutButton } from "@/components/SignOutButton";
import { AutoRefresh } from "@/components/AutoRefresh";
import { DemoGuide } from "@/components/DemoGuide";
import { ZMark } from "@/components/Logo";

/**
 * The console shell: header, status badges, tabs, presenter guide.
 *
 * The console is split into one-job pages — Market, Investors, Trade, Controls, Ledger,
 * Operations — because a single page carrying all of it read as a back office, not a demo.
 * This layout persists across those pages, which is also what keeps the presenter guide's
 * position alive while it navigates between tabs.
 */
export default async function ConsoleLayout({ children }: { children: ReactNode }) {
  // Staff-only, exactly as before the split: these pages carry controls over client money.
  const user = await currentUser();
  if (!user) redirect("/login");
  if (user.role !== "admin") redirect("/account");

  const strip = await tryStatusStrip();

  if (!strip.data) {
    return (
      <main className="mx-auto max-w-2xl p-8">
        <h1 className="text-xl font-semibold tracking-tight">Permissioned RWA console</h1>
        <div className="mt-5 rounded-lg border p-5" style={{ background: "var(--panel)", borderColor: "var(--line)" }}>
          <p className="text-sm" style={{ color: "var(--bad)" }}>Not connected to a chain</p>
          <p className="mt-2 text-xs leading-relaxed" style={{ color: "var(--muted)" }}>{strip.reason}</p>
          <p className="mt-4 text-[11px] leading-relaxed" style={{ color: "var(--muted)" }}>
            Running locally? Start the chain with <span className="font-mono">./ops/reset.sh</span> and reload.
            Hosted? The deployment needs <span className="font-mono">RPC_URL</span>,{" "}
            <span className="font-mono">CHAIN_ID</span> and <span className="font-mono">ADDRESSES_JSON</span>.
          </p>
        </div>
      </main>
    );
  }

  const s = strip.data;

  return (
    <main className="mx-auto max-w-[1200px] space-y-4 p-5">
      <header className="flex flex-wrap items-end justify-between gap-4" data-tour="header">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">{s.custodianName}</h1>
          <p className="mt-1 text-xs" style={{ color: "var(--muted)" }}>
            {s.assetName} ({s.symbol}) — ERC-3643 fund on a permissioned Uniswap v4 pool
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href="/portal"
            className="rounded border px-2.5 py-1 text-xs transition-opacity hover:opacity-80"
            style={{ borderColor: "var(--line)", color: "var(--accent)" }}
          >
            Onboarding →
          </Link>
          <Link
            href="/build"
            className="rounded border px-2.5 py-1 text-xs transition-opacity hover:opacity-80"
            style={{ borderColor: "var(--line)", color: "var(--accent)" }}
          >
            How it was built →
          </Link>
          {s.paused ? <Badge tone="bad">asset paused</Badge> : <Badge tone="ok">asset live</Badge>}
          {s.swappingEnabled ? <Badge tone="ok">trading on</Badge> : <Badge tone="warn">trading off</Badge>}
          {s.enforceCountry && <Badge tone="accent">jurisdictions enforced</Badge>}
          <ResetButton armed={s.baselineArmed} />
          <span className="flex items-center gap-2 text-[11px]" style={{ color: "var(--muted)" }}>
            <AutoRefresh seconds={6} />
            {user.email}
            <SignOutButton />
          </span>
        </div>
      </header>

      <NavTabs />

      {children}

      <footer
        className="flex flex-wrap items-center justify-between gap-3 border-t pb-6 pt-4 text-[11px]"
        style={{ borderColor: "var(--line)", color: "var(--muted)" }}
      >
        <span className="inline-flex items-center gap-2">
          <ZMark size={13} />
          <span>Compliance layer built on OpenZeppelin</span>
        </span>
        <span>chain {s.chainId} · contract addresses under Operations</span>
      </footer>

      <DemoGuide />
    </main>
  );
}
