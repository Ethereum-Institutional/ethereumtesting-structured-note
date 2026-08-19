import Link from "next/link";
import { formatUnits } from "viem";
import { pendingApplication, applicantStatus } from "@/lib/applications";
import { addresses } from "@/lib/chain";
import { Panel, Badge, Mono, short, num } from "@/components/ui";
import { PortalForm } from "@/components/PortalForm";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const SUGGESTED = "14 Macquarie Street, Sydney NSW 2000, Australia";

export default async function PortalPage() {
  const app = pendingApplication();

  let status: Awaited<ReturnType<typeof applicantStatus>> | null = null;
  let decimals = 18;
  let symbol = "APACDC";
  try {
    status = await applicantStatus(app.wallet);
    const a = addresses();
    decimals = a.trex.decimals;
    symbol = a.trex.tokenSymbol;
  } catch {
    /* chain unreachable — the form still explains itself */
  }

  const approved = Boolean(status?.verified);

  return (
    <main className="mx-auto max-w-4xl p-5 pb-16">
      <nav className="mb-6 flex flex-wrap items-center gap-3 text-xs">
        <Link href="/" className="rounded border px-2.5 py-1 transition-opacity hover:opacity-80"
          style={{ borderColor: "var(--line)", color: "var(--muted)" }}>
          &larr; Live console
        </Link>
        <Link href="/build" className="rounded border px-2.5 py-1 transition-opacity hover:opacity-80"
          style={{ borderColor: "var(--line)", color: "var(--muted)" }}>
          How it was built
        </Link>
        <span style={{ color: "var(--muted)" }}>You are on: investor onboarding portal</span>
      </nav>

      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Investor onboarding</h1>
        <p className="mt-2 text-sm leading-relaxed" style={{ color: "var(--muted)" }}>
          The KYC provider&apos;s review queue. This is where an off-chain file becomes an on-chain
          permission: sign off an application here and the applicant&apos;s wallet can trade the
          asset, with no action by the venue and nothing personal written to the chain.
        </p>
        <p className="mt-2 text-[11px]" style={{ color: "var(--warn)" }}>
          All applicant details on this page are fictional.
        </p>
      </header>

      <div className="mt-6 grid gap-4 lg:grid-cols-[1.25fr_1fr]">
        <Panel
          title={`Application ${app.reference}`}
          subtitle={`${app.applicant} · submitted ${app.submitted}`}
          right={approved ? <Badge tone="ok">approved</Badge> : <Badge tone="warn">incomplete</Badge>}
        >
          <dl className="space-y-2 text-xs">
            {app.fields.map((f) => (
              <div key={f.key} className="flex items-baseline justify-between gap-3 border-b pb-2 last:border-0 last:pb-0"
                style={{ borderColor: "var(--line)" }}>
                <dt style={{ color: "var(--muted)" }}>{f.label}</dt>
                <dd className="text-right">
                  {f.missing && !approved ? (
                    <Badge tone="bad">not supplied</Badge>
                  ) : f.missing && approved ? (
                    <span style={{ color: "var(--ok)" }}>{SUGGESTED}</span>
                  ) : f.screening ? (
                    <span style={{ color: "var(--ok)" }}>{f.value}</span>
                  ) : (
                    f.value
                  )}
                </dd>
              </div>
            ))}
            <div className="flex items-baseline justify-between gap-3 pt-1">
              <dt style={{ color: "var(--muted)" }}>Wallet</dt>
              <dd><Mono title={app.wallet}>{short(app.wallet)}</Mono></dd>
            </div>
          </dl>
        </Panel>

        <div className="space-y-4">
          <Panel title="On-chain status" subtitle="Read live from the issuer's registry">
            {status ? (
              <>
                <dl className="space-y-1.5 text-xs">
                  <div className="flex justify-between gap-3">
                    <dt style={{ color: "var(--muted)" }}>Registered holder</dt>
                    <dd><Badge tone={status.registered ? "ok" : "bad"}>{String(status.registered)}</Badge></dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt style={{ color: "var(--muted)" }}>Identity verified</dt>
                    <dd><Badge tone={status.verified ? "ok" : "bad"}>{String(status.verified)}</Badge></dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt style={{ color: "var(--muted)" }}>Wallet frozen</dt>
                    <dd><Badge tone={status.frozen ? "bad" : "ok"}>{String(status.frozen)}</Badge></dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt style={{ color: "var(--muted)" }}>May trade</dt>
                    <dd>
                      <span className="flex gap-1">
                        <Badge tone={status.canSwap ? "ok" : "bad"}>swap</Badge>
                        <Badge tone={status.canProvideLiquidity ? "ok" : "bad"}>LP</Badge>
                      </span>
                    </dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt style={{ color: "var(--muted)" }}>Holding</dt>
                    <dd><Mono>{num(formatUnits(status.assetBalance, decimals), 0)} {symbol}</Mono></dd>
                  </div>
                </dl>
                <div className="mt-3 rounded border p-2.5 text-[11px] leading-relaxed"
                  style={{
                    borderColor: status.gate === "clear" ? "rgba(53,201,138,.3)" : "rgba(255,107,107,.3)",
                    background: status.gate === "clear" ? "rgba(53,201,138,.06)" : "rgba(255,107,107,.06)",
                    color: status.gate === "clear" ? "var(--ok)" : "var(--bad)",
                  }}>
                  {status.gate === "clear"
                    ? "Cleared. This wallet can now trade the asset."
                    : `Blocked: ${status.gate}.`}
                </div>
              </>
            ) : (
              <p className="text-xs" style={{ color: "var(--muted)" }}>
                Chain unreachable — status unavailable.
              </p>
            )}
          </Panel>

          <Panel title="What goes on-chain" subtitle="And, more to the point, what does not">
            <p className="text-[11px] leading-relaxed" style={{ color: "var(--muted)" }}>
              Approving writes two claims signed by the trusted issuer. Each carries the application
              reference and a keccak digest of the file — nothing else. An auditor handed the file
              can prove it produced that claim; anyone reading the chain learns only that a trusted
              issuer attested something about this wallet.
            </p>
            <p className="mt-2 text-[11px] leading-relaxed" style={{ color: "var(--muted)" }}>
              The venue never sees any of it. It asks the issuer&apos;s registry a yes/no question at
              the moment of the trade.
            </p>
          </Panel>
        </div>
      </div>

      <div className="mt-4">
        <Panel
          title="Compliance review"
          subtitle={approved ? "This application has been signed off" : "Complete the file, then sign off"}
        >
          <PortalForm suggestedAddress={SUGGESTED} alreadyApproved={approved} />
        </Panel>
      </div>

      {approved && (
        <div className="mt-6 flex flex-wrap items-center gap-3">
          <Link href="/" className="rounded px-4 py-2 text-xs font-semibold uppercase tracking-wide transition-opacity hover:opacity-90"
            style={{ background: "var(--accent)", color: "#07101f" }}>
            Trade as {app.applicant.split(" ")[0]} &rarr;
          </Link>
          <span className="text-[11px]" style={{ color: "var(--muted)" }}>
            The console&apos;s activity feed shows every call this approval made.
          </span>
        </div>
      )}
    </main>
  );
}
