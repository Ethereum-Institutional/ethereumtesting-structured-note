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
import { passportOf, type Passport } from "@/lib/passport";
import { plainGate } from "@/lib/gates";
import { addresses, publicClient, poolId, priceFromSqrt, COUNTRY_NAMES } from "@/lib/chain";
import { ERC20_ABI, STATE_VIEW_ABI } from "@/lib/abis";
import { Panel, Stat, Badge, Mono, short, num } from "@/components/ui";
import { StatusBadge } from "@/components/StatusBadge";
import { ProfileForm } from "@/components/ProfileForm";
import { InvestorTrade } from "@/components/InvestorTrade";
import { PassportCard } from "@/components/PassportCard";
import { SignOutButton } from "@/components/SignOutButton";
import { AutoRefresh } from "@/components/AutoRefresh";
import { ProvisionWatcher } from "@/components/ProvisionWatcher";

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

  // Everything below is read live from the chain: the passport the market checks, the balances,
  // the current pool price, and whichever gate (if any) would stop the next order.
  let chain: Awaited<ReturnType<typeof applicantStatus>> | null = null;
  let passport: Passport | null = null;
  let cash = 0n;
  let decimals = 18;
  let symbol = "APMMF";
  let poolPrice: number | null = null;
  // A demo reset can revert the chain to before this account's contract existed. The record
  // survives in the database, so detect the gap and let ProvisionWatcher rebuild it.
  let walletDead = false;
  if (app.wallet) {
    try {
      const a = addresses();
      decimals = a.trex.decimals;
      symbol = a.trex.tokenSymbol;
      let code: string | undefined;
      [chain, passport, cash, code] = await Promise.all([
        applicantStatus(app.wallet as `0x${string}`),
        passportOf(app.wallet as `0x${string}`),
        publicClient.readContract({
          address: a.venue.usdc, abi: ERC20_ABI, functionName: "balanceOf", args: [app.wallet as `0x${string}`],
        }) as Promise<bigint>,
        publicClient.getCode({ address: app.wallet as `0x${string}` }),
      ]);
      walletDead = !code || code === "0x";
      const slot0 = (await publicClient.readContract({
        address: a.lens.stateView, abi: STATE_VIEW_ABI, functionName: "getSlot0", args: [poolId(a)],
      })) as any;
      const assetIs0 = a.pool.currency0.toLowerCase() === a.venue.permissionsAdapter.toLowerCase();
      poolPrice = priceFromSqrt(slot0[0], assetIs0);
    } catch {
      /* chain unreachable */
    }
  }

  const accOk = accreditationPermitsApproval(app.accreditationLevel);
  const approved = app.status === "approved";
  const displayName =
    app.accountType === "entity" ? app.entityName ?? app.applicantName : app.applicantName;

  return (
    <main className="mx-auto max-w-4xl p-5 pb-16">
      <nav className="mb-6 flex flex-wrap items-center gap-3 text-xs">
        <span className="font-semibold">Meridian Custody</span>
        <Link href="/build" className="rounded border px-2.5 py-1 transition-opacity hover:opacity-80"
          style={{ borderColor: "var(--line)", color: "var(--muted)" }}>How this works</Link>
        <span className="ml-auto flex items-center gap-3" style={{ color: "var(--muted)" }}>
          <AutoRefresh seconds={6} />
          {user.email}
          <SignOutButton />
        </span>
      </nav>

      <header>
        <h1 className="text-2xl font-semibold tracking-tight">{displayName}</h1>
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
        {(!app.wallet || walletDead) && <ProvisionWatcher />}

        <PassportCard
          name={displayName}
          countryName={
            // The registry's country once registered on-chain; the declared one before that.
            COUNTRY_NAMES[passport?.country || app.country || 0] ?? "—"
          }
          wallet={app.wallet}
          passport={passport}
        />

        <Panel title="Your account" subtitle="Held in a segregated custody account — balances read live from the chain">
          <div className="grid grid-cols-2 gap-4">
            <Stat
              label={`Fund holding (${symbol})`}
              value={chain ? num(formatUnits(chain.assetBalance, decimals), 0) : "—"}
            />
            <Stat label="Settlement cash (USDC)" value={num(formatUnits(cash, 6), 0)} />
          </div>
          <dl className="mt-4 space-y-1.5 text-xs">
            <div className="flex justify-between gap-3">
              <dt style={{ color: "var(--muted)" }}>Custody account</dt>
              <dd>{app.wallet ? <Mono title={app.wallet}>{short(app.wallet)}</Mono> : <Badge tone="warn">opening</Badge>}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt style={{ color: "var(--muted)" }}>May trade</dt>
              <dd className="flex gap-1">
                <Badge tone={chain?.canSwap ? "ok" : "bad"}>subscribe / redeem</Badge>
                <Badge tone={chain?.canProvideLiquidity ? "ok" : "bad"}>provide liquidity</Badge>
              </dd>
            </div>
          </dl>
          {chain && chain.gate !== "clear" && (
            <p className="mt-3 rounded border px-2.5 py-2 text-xs leading-relaxed"
              style={{ borderColor: "rgba(255,107,107,.3)", background: "rgba(255,107,107,.06)", color: "var(--bad)" }}>
              {plainGate(chain.gate)}. The pool itself will reject your orders until this clears —
              it is enforced by the market&apos;s compliance hook, not by this app.
            </p>
          )}
        </Panel>

        {approved && app.wallet ? (
          <Panel
            title="Place an order"
            subtitle="Buy or sell fund units on the live pool — the hook checks your passport on every order"
            right={
              poolPrice !== null ? (
                <span className="text-xs" style={{ color: "var(--muted)" }}>
                  live pool price <span className="font-mono" style={{ color: "var(--text)" }}>{num(poolPrice)} USDC</span> / {symbol}
                </span>
              ) : undefined
            }
          >
            <InvestorTrade
              symbol={symbol}
              cash={num(formatUnits(cash, 6), 0)}
              holding={chain ? num(formatUnits(chain.assetBalance, decimals), 0) : "0"}
            />
          </Panel>
        ) : (
          <>
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
          </>
        )}

        {app.status === "rejected" && app.rejectionReason && (
          <Panel title="Application declined">
            <p className="text-xs" style={{ color: "var(--bad)" }}>{app.rejectionReason}</p>
          </Panel>
        )}

        <Panel title="What we put on the blockchain" subtitle="And what stays here">
          <p className="text-[11px] leading-relaxed" style={{ color: "var(--muted)" }}>
            Your name, date of birth, passport number and address never leave this system. What
            goes on-chain is your passport: an identity contract, carrying claims signed by the
            fund&apos;s KYC provider that contain only this application&apos;s reference and a
            cryptographic digest of the record. The market verifies the signature — it never sees
            the file.
          </p>
          {app.claimDigest && (
            <p className="mt-2 text-[11px]" style={{ color: "var(--muted)" }}>
              Your record digest: <Mono>{app.claimDigest.slice(0, 18)}…</Mono>
            </p>
          )}
        </Panel>
      </div>

      <footer className="mt-6 space-y-1 text-[11px]" style={{ color: "var(--muted)" }}>
        <p>
          Asset: ERC-3643 (T-REX) by Tokeny · Venue: Uniswap v4 permissioned pool · Compliance
          layer and custody accounts: OpenZeppelin
        </p>
        <p>store: <Mono>{driverName}</Mono>{!isDurable && " — resets on restart"}</p>
      </footer>
    </main>
  );
}
