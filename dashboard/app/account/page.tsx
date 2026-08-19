import Link from "next/link";
import { redirect } from "next/navigation";
import { formatUnits } from "viem";
import { currentUser } from "@/lib/auth";
import { ensureMyAccount } from "@/app/platform-actions";
import { getApplicationByUser, driverName, isDurable } from "@/lib/db";
import {
  missingFields, isComplete, requiredFields, FIELD_LABELS,
  ACCREDITATION_LABEL, accreditationPermitsApproval, THRESHOLDS,
} from "@/lib/db/types";
import { suggestionFor } from "@/lib/fake";
import { applicantStatus } from "@/lib/applications";
import { addresses, publicClient } from "@/lib/chain";
import { ERC20_ABI } from "@/lib/abis";
import { Panel, Badge, Mono, short, num } from "@/components/ui";
import { StatusBadge } from "@/components/StatusBadge";
import { ProfileForm } from "@/components/ProfileForm";
import { InvestorTrade } from "@/components/InvestorTrade";
import { SignOutButton } from "@/components/SignOutButton";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function AccountPage() {
  const user = await currentUser();
  if (!user) redirect("/login");
  if (user.role === "admin") redirect("/portal/admin");

  await ensureMyAccount();
  const app = await getApplicationByUser(user.id);
  if (!app) {
    return (
      <main className="mx-auto max-w-2xl p-8">
        <Panel title="Account unavailable" subtitle="We could not open your file">
          <p className="text-xs" style={{ color: "var(--muted)" }}>
            Try reloading. If it persists the platform store may be unreachable.
          </p>
        </Panel>
      </main>
    );
  }

  const missing = missingFields(app);
  const complete = isComplete(app);

  // The investor may edit their own declared details, plus the figures accreditation rests on.
  const editable = [
    ...requiredFields(app.accountType),
    "phone",
    ...(app.accountType === "entity" ? ["entityNetAssets"] : ["netFinancialAssets", "annualIncome"]),
  ];
  const suggestions = Object.fromEntries(
    editable.map((f) => [f, suggestionFor(f, user.email)]).filter(([, v]) => v),
  ) as Record<string, string>;

  let chain: Awaited<ReturnType<typeof applicantStatus>> | null = null;
  let cash = 0n;
  let decimals = 18;
  let symbol = "APACDC";
  if (app.wallet) {
    try {
      const a = addresses();
      decimals = a.trex.decimals;
      symbol = a.trex.tokenSymbol;
      chain = await applicantStatus(app.wallet as `0x${string}`);
      cash = (await publicClient.readContract({
        address: a.venue.usdc, abi: ERC20_ABI, functionName: "balanceOf", args: [app.wallet as `0x${string}`],
      })) as bigint;
    } catch {
      /* chain unreachable */
    }
  }

  const accOk = accreditationPermitsApproval(app.accreditationLevel);

  return (
    <main className="mx-auto max-w-4xl p-5 pb-16">
      <nav className="mb-6 flex flex-wrap items-center gap-3 text-xs">
        <span className="font-semibold">Meridian Custody</span>
        <Link href="/build" className="rounded border px-2.5 py-1 transition-opacity hover:opacity-80"
          style={{ borderColor: "var(--line)", color: "var(--muted)" }}>How this works</Link>
        <span className="ml-auto flex items-center gap-3" style={{ color: "var(--muted)" }}>
          {user.email}
          <SignOutButton />
        </span>
      </nav>

      <header>
        <h1 className="text-2xl font-semibold tracking-tight">
          {app.accountType === "entity" ? app.entityName ?? app.applicantName : app.applicantName}
        </h1>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Badge tone={app.accountType === "entity" ? "accent" : "muted"}>
            {app.accountType === "entity" ? "entity account" : "individual account"}
          </Badge>
          <StatusBadge status={app.status} />
          <Badge tone={accOk ? "ok" : "bad"}>{ACCREDITATION_LABEL[app.accreditationLevel]}</Badge>
          <Mono>{app.reference}</Mono>
        </div>
        <p className="mt-2 text-[11px]" style={{ color: "var(--warn)" }}>
          Demonstration account. The details below were invented for you — do not replace them with
          your own.
        </p>
      </header>

      <div className="mt-6 space-y-4">
        <div className="grid gap-4 lg:grid-cols-2">
          <Panel title="Your account" subtitle="Held in a segregated custody account">
            <dl className="space-y-1.5 text-xs">
              <div className="flex justify-between gap-3">
                <dt style={{ color: "var(--muted)" }}>Custody account</dt>
                <dd>{app.wallet ? <Mono title={app.wallet}>{short(app.wallet)}</Mono> : <Badge tone="warn">provisioning</Badge>}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt style={{ color: "var(--muted)" }}>Settlement cash</dt>
                <dd><Mono>{num(formatUnits(cash, 6), 0)} USDC</Mono></dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt style={{ color: "var(--muted)" }}>Fund holding</dt>
                <dd><Mono>{chain ? num(formatUnits(chain.assetBalance, decimals), 0) : "—"} {symbol}</Mono></dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt style={{ color: "var(--muted)" }}>May trade</dt>
                <dd className="flex gap-1">
                  <Badge tone={chain?.canSwap ? "ok" : "bad"}>subscribe</Badge>
                  <Badge tone={chain?.canProvideLiquidity ? "ok" : "bad"}>provide liquidity</Badge>
                </dd>
              </div>
            </dl>
            {chain && chain.gate !== "clear" && (
              <p className="mt-3 rounded border px-2.5 py-2 text-[11px]"
                style={{ borderColor: "rgba(255,107,107,.3)", background: "rgba(255,107,107,.06)", color: "var(--bad)" }}>
                Not yet permitted to trade: {chain.gate}.
              </p>
            )}
          </Panel>

          <Panel title="Accreditation" subtitle="This fund is restricted to accredited investors">
            <p className="text-xs leading-relaxed">
              {app.accreditationBasis ?? "Not yet assessed."}
            </p>
            <div className="mt-3 border-t pt-3 text-[11px] leading-relaxed" style={{ borderColor: "var(--line)", color: "var(--muted)" }}>
              {app.accountType === "entity" ? (
                <>An entity qualifies with net assets of at least S${THRESHOLDS.entityNetAssets.toLocaleString()}.</>
              ) : (
                <>
                  An individual qualifies with net financial assets of at least
                  S${THRESHOLDS.individualNetFinancialAssets.toLocaleString()} <em>or</em> annual income of at
                  least S${THRESHOLDS.individualAnnualIncome.toLocaleString()}.
                </>
              )}
            </div>
            {!accOk && (
              <p className="mt-3 rounded border px-2.5 py-2 text-[11px]"
                style={{ borderColor: "rgba(255,107,107,.3)", color: "var(--bad)" }}>
                On the figures declared this fund is not available to you. Compliance cannot approve
                a retail file for a restricted fund.
              </p>
            )}
          </Panel>
        </div>

        {app.status === "approved" && chain?.canSwap ? (
          <Panel title="Place an order" subtitle="Subscribe to or redeem from the fund">
            <InvestorTrade
              symbol={symbol}
              cash={num(formatUnits(cash, 6), 0)}
              holding={chain ? num(formatUnits(chain.assetBalance, decimals), 0) : "0"}
            />
          </Panel>
        ) : (
          <Panel
            title={missing.length ? "Complete your application" : "Your application"}
            subtitle={
              missing.length
                ? `Outstanding: ${missing.map((f) => FIELD_LABELS[f] ?? f).join(", ")}`
                : app.status === "in_review"
                  ? "With compliance for review"
                  : "Ready to submit"
            }
          >
            <ProfileForm
              app={app}
              editable={editable}
              missing={missing}
              complete={complete}
              suggestions={suggestions}
            />
          </Panel>
        )}

        {app.status === "rejected" && app.rejectionReason && (
          <Panel title="Application declined">
            <p className="text-xs" style={{ color: "var(--bad)" }}>{app.rejectionReason}</p>
          </Panel>
        )}

        <Panel title="What we put on the blockchain" subtitle="And what stays here">
          <p className="text-[11px] leading-relaxed" style={{ color: "var(--muted)" }}>
            Nothing on this page goes on-chain. When your application is approved, the fund&apos;s
            KYC provider signs claims against your custody account carrying two things: this
            application&apos;s reference, and a cryptographic digest of the record. Your name, date
            of birth, passport number and address stay in this system.
          </p>
          {app.claimDigest && (
            <p className="mt-2 text-[11px]" style={{ color: "var(--muted)" }}>
              Your record digest: <Mono>{app.claimDigest.slice(0, 18)}…</Mono>
            </p>
          )}
        </Panel>
      </div>

      <footer className="mt-6 text-[11px]" style={{ color: "var(--muted)" }}>
        store: <Mono>{driverName}</Mono>{!isDurable && " — resets on restart"}
      </footer>
    </main>
  );
}
