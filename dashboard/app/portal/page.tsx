import Link from "next/link";
import { formatUnits } from "viem";
import { seedIfEmpty } from "@/lib/db/seed";
import { listApplications, getApplicationByWallet, driverName, isDurable } from "@/lib/db";
import { missingFields, FIELD_LABELS, type Application } from "@/lib/db/types";
import { applicantStatus } from "@/lib/applications";
import { addresses } from "@/lib/chain";
import { Panel, Badge, Mono, short, num } from "@/components/ui";
import { StatusBadge } from "@/components/StatusBadge";
import { InvestorView } from "@/components/InvestorView";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const SUGGESTED = "14 Macquarie Street, Sydney NSW 2000, Australia";

/** Rows the investor is shown, in the order a person would read their own file. */
const SHOWN: Array<keyof Application> = [
  "legalName",
  "dob",
  "nationality",
  "taxId",
  "residentialAddress",
  "sourceOfFunds",
  "classification",
  "sanctionsResult",
  "pepResult",
  "adverseMediaResult",
];

export default async function PortalPage() {
  let app: Application | null = null;
  let error: string | null = null;
  try {
    await seedIfEmpty();
    const a = addresses();
    app = await getApplicationByWallet(a.roles.unverified);
    if (!app) app = (await listApplications())[0] ?? null;
  } catch (e: any) {
    error = String(e?.message ?? e).slice(0, 200);
  }

  let chain: Awaited<ReturnType<typeof applicantStatus>> | null = null;
  let decimals = 18;
  let symbol = "APACDC";
  if (app) {
    try {
      chain = await applicantStatus(app.wallet as `0x${string}`);
      const a = addresses();
      decimals = a.trex.decimals;
      symbol = a.trex.tokenSymbol;
    } catch {
      /* chain unreachable */
    }
  }

  const missing = app ? missingFields(app) : [];

  return (
    <main className="mx-auto max-w-4xl p-5 pb-16">
      <nav className="mb-6 flex flex-wrap items-center gap-3 text-xs">
        <Link href="/" className="rounded border px-2.5 py-1 transition-opacity hover:opacity-80"
          style={{ borderColor: "var(--line)", color: "var(--muted)" }}>
          &larr; Live console
        </Link>
        <Link href="/portal/admin" className="rounded border px-2.5 py-1 transition-opacity hover:opacity-80"
          style={{ borderColor: "var(--line)", color: "var(--accent)" }}>
          Compliance admin &rarr;
        </Link>
        <span className="ml-auto" style={{ color: "var(--muted)" }}>
          store: <Mono>{driverName}</Mono>{!isDurable && " — resets on restart"}
        </span>
      </nav>

      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Your subscription application</h1>
        <p className="mt-2 text-sm leading-relaxed" style={{ color: "var(--muted)" }}>
          {app ? `${app.applicantName} · ${app.reference}` : "Investor portal"}
        </p>
        <p className="mt-2 text-[11px]" style={{ color: "var(--warn)" }}>
          Fictional applicant, for demonstration.
        </p>
        {error && (
          <p className="mt-3 rounded border px-3 py-2 text-xs"
            style={{ borderColor: "rgba(255,107,107,.35)", color: "var(--bad)" }}>
            Store unavailable: {error}
          </p>
        )}
      </header>

      {app && (
        <div className="mt-6 space-y-4">
          <Panel
            title="Where your application stands"
            right={<StatusBadge status={app.status} />}
          >
            {missing.length > 0 ? (
              <p className="text-xs leading-relaxed">
                We are waiting on{" "}
                <strong style={{ color: "var(--bad)" }}>
                  {missing.map((f) => FIELD_LABELS[f].toLowerCase()).join(", ")}
                </strong>
                . Everything else has been received and screened.
              </p>
            ) : app.status === "approved" ? (
              <p className="text-xs leading-relaxed" style={{ color: "var(--ok)" }}>
                Approved. Your wallet is a registered holder and you can trade the fund.
              </p>
            ) : (
              <p className="text-xs leading-relaxed">
                Your file is complete and with compliance for review.
              </p>
            )}
            {chain && (
              <div className="mt-3 flex flex-wrap items-center gap-2 border-t pt-3" style={{ borderColor: "var(--line)" }}>
                <span className="text-[10px] uppercase tracking-wider" style={{ color: "var(--muted)" }}>
                  Wallet {short(app.wallet)}
                </span>
                <Badge tone={chain.verified ? "ok" : "bad"}>
                  {chain.verified ? "verified holder" : "not yet a holder"}
                </Badge>
                <Badge tone={chain.canSwap ? "ok" : "bad"}>swap</Badge>
                <Badge tone={chain.canProvideLiquidity ? "ok" : "bad"}>provide liquidity</Badge>
                <span className="text-[11px]" style={{ color: "var(--muted)" }}>
                  holding {num(formatUnits(chain.assetBalance, decimals), 0)} {symbol}
                </span>
              </div>
            )}
          </Panel>

          <Panel title="Outstanding items" subtitle="Supply anything still missing here">
            <InvestorView app={app} missing={missing} suggestion={SUGGESTED} />
          </Panel>

          <Panel title="What we hold on file" subtitle="Read-only — contact us to correct anything">
            <dl className="space-y-2 text-xs">
              {SHOWN.map((k) => {
                const v = app![k];
                const isMissing = missing.includes(k as any);
                return (
                  <div key={String(k)} className="flex items-baseline justify-between gap-3 border-b pb-2 last:border-0 last:pb-0"
                    style={{ borderColor: "var(--line)" }}>
                    <dt style={{ color: "var(--muted)" }}>{FIELD_LABELS[k as any] ?? String(k)}</dt>
                    <dd className="text-right">
                      {isMissing || v == null || String(v) === "" ? (
                        <Badge tone="bad">not supplied</Badge>
                      ) : (
                        String(v)
                      )}
                    </dd>
                  </div>
                );
              })}
            </dl>
          </Panel>

          <Panel title="What we put on the blockchain" subtitle="And what we keep here instead">
            <p className="text-[11px] leading-relaxed" style={{ color: "var(--muted)" }}>
              Nothing on this page goes on-chain. When your application is approved, the fund&apos;s
              KYC provider signs a claim against your wallet carrying two things: this
              application&apos;s reference, and a cryptographic digest of the record. Your name, date
              of birth and address stay in this system.
            </p>
            <p className="mt-2 text-[11px] leading-relaxed" style={{ color: "var(--muted)" }}>
              The trading venue never receives any of it. At the moment of a trade it asks the
              fund&apos;s registry a single yes-or-no question about your wallet.
            </p>
          </Panel>
        </div>
      )}
    </main>
  );
}
