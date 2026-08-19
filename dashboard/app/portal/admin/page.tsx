import Link from "next/link";
import { redirect } from "next/navigation";
import { formatUnits } from "viem";
import { currentUser } from "@/lib/auth";
import { seedIfEmpty } from "@/lib/db/seed";
import { listApplications, getApplication, listEvents, driverName, isDurable } from "@/lib/db";
import {
  isComplete, missingFields, FIELD_LABELS, STATUS_LABEL, ACCREDITATION_LABEL,
  accreditationPermitsApproval, type ApplicationStatus,
} from "@/lib/db/types";
import { applicantStatus } from "@/lib/applications";
import { addresses } from "@/lib/chain";
import { Panel, Badge, Mono, short, num } from "@/components/ui";
import { StatusBadge, STATUS_TONE } from "@/components/StatusBadge";
import { AdminReview } from "@/components/AdminReview";
import { SignOutButton } from "@/components/SignOutButton";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function AdminPage({ searchParams }: { searchParams: Promise<{ id?: string }> }) {
  const user = await currentUser();
  if (!user) redirect("/login");
  if (user.role !== "admin") redirect("/account");

  const { id } = await searchParams;

  let apps: Awaited<ReturnType<typeof listApplications>> = [];
  let storeError: string | null = null;
  try {
    await seedIfEmpty();
    apps = await listApplications();
  } catch (e: any) {
    storeError = String(e?.message ?? e).slice(0, 200);
  }

  const selected = id ? await getApplication(id).catch(() => null) : null;
  const events = selected ? await listEvents(selected.id).catch(() => []) : [];

  let chain: Awaited<ReturnType<typeof applicantStatus>> | null = null;
  let decimals = 18;
  let symbol = "APACDC";
  if (selected?.wallet) {
    try {
      chain = await applicantStatus(selected.wallet as `0x${string}`);
      const a = addresses();
      decimals = a.trex.decimals;
      symbol = a.trex.tokenSymbol;
    } catch {
      /* chain unreachable */
    }
  }

  const counts = apps.reduce<Record<string, number>>((acc, a) => {
    acc[a.status] = (acc[a.status] ?? 0) + 1;
    return acc;
  }, {});
  const actionable = apps.filter((a) => a.status === "in_review" || a.status === "submitted").length;

  return (
    <main className="mx-auto max-w-[1400px] p-5 pb-16">
      <nav className="mb-5 flex flex-wrap items-center gap-3 text-xs">
        <span className="font-semibold">Meridian Custody</span>
        <Link href="/" className="rounded border px-2.5 py-1 transition-opacity hover:opacity-80"
          style={{ borderColor: "var(--line)", color: "var(--muted)" }}>Custody console</Link>
        <Link href="/build" className="rounded border px-2.5 py-1 transition-opacity hover:opacity-80"
          style={{ borderColor: "var(--line)", color: "var(--muted)" }}>How it was built</Link>
        <span className="ml-auto flex items-center gap-3" style={{ color: "var(--muted)" }}>
          {user.email} · compliance
          <SignOutButton />
        </span>
      </nav>

      <header className="mb-5">
        <h1 className="text-xl font-semibold tracking-tight">Onboarding administration</h1>
        <p className="mt-1 text-xs" style={{ color: "var(--muted)" }}>
          Edit any field, sign a file off, and the investor&apos;s on-chain permission changes on the
          next block. Applicant details are fictional.
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {Object.entries(counts).map(([k, v]) => (
            <Badge key={k} tone={STATUS_TONE[k as ApplicationStatus] ?? "muted"}>
              {v} {STATUS_LABEL[k as ApplicationStatus] ?? k}
            </Badge>
          ))}
          {actionable > 0 && (
            <span className="ml-1 text-[11px]" style={{ color: "var(--warn)" }}>
              {actionable} awaiting your decision
            </span>
          )}
        </div>
        {storeError && (
          <p className="mt-2 rounded border px-3 py-2 text-xs"
            style={{ borderColor: "rgba(255,107,107,.35)", color: "var(--bad)" }}>
            Store unavailable: {storeError}
          </p>
        )}
      </header>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,360px)_1fr]">
        <Panel title="Queue" subtitle={`${apps.length} accounts`}>
          <ul className="-mx-4">
            {apps.map((a) => {
              const isSel = selected?.id === a.id;
              const gaps = missingFields(a).length;
              const accOk = accreditationPermitsApproval(a.accreditationLevel);
              return (
                <li key={a.id} className="border-t first:border-0" style={{ borderColor: "var(--line)" }}>
                  <Link href={`/portal/admin?id=${a.id}`} className="block px-4 py-2.5"
                    style={{ background: isSel ? "var(--panel-2)" : "transparent" }}>
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="text-xs font-medium">{a.applicantName}</span>
                      <StatusBadge status={a.status} />
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[10px]" style={{ color: "var(--muted)" }}>
                      <Mono>{a.reference}</Mono>
                      <Badge tone={a.accountType === "entity" ? "accent" : "muted"}>{a.accountType}</Badge>
                      <Badge tone={accOk ? "ok" : "bad"}>{ACCREDITATION_LABEL[a.accreditationLevel]}</Badge>
                      {gaps > 0 && <span style={{ color: "var(--bad)" }}>{gaps} outstanding</span>}
                      {!a.wallet && <span style={{ color: "var(--warn)" }}>no account yet</span>}
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        </Panel>

        <div className="space-y-4">
          {!selected ? (
            <Panel title="No file selected" subtitle="Pick an account from the queue">
              <p className="text-xs" style={{ color: "var(--muted)" }}>
                Files marked <em>in review</em> are waiting on you. Live sign-ups from the event appear
                here automatically.
              </p>
            </Panel>
          ) : (
            <>
              <Panel
                title={`${selected.reference} — ${selected.applicantName}`}
                subtitle={`${selected.accountType} · submitted ${selected.submittedAt?.slice(0, 10) ?? "—"} · ${
                  selected.wallet ? `custody account ${short(selected.wallet)}` : "no custody account yet"
                }`}
                right={<StatusBadge status={selected.status} />}
              >
                <div className="grid gap-4 lg:grid-cols-2">
                  <div>
                    <div className="text-[10px] uppercase tracking-wider" style={{ color: "var(--muted)" }}>
                      On-chain status
                    </div>
                    {chain ? (
                      <dl className="mt-1.5 space-y-1 text-xs">
                        <div className="flex justify-between gap-2">
                          <dt style={{ color: "var(--muted)" }}>Verified holder</dt>
                          <dd><Badge tone={chain.verified ? "ok" : "bad"}>{String(chain.verified)}</Badge></dd>
                        </div>
                        <div className="flex justify-between gap-2">
                          <dt style={{ color: "var(--muted)" }}>Wallet frozen</dt>
                          <dd><Badge tone={chain.frozen ? "bad" : "ok"}>{String(chain.frozen)}</Badge></dd>
                        </div>
                        <div className="flex justify-between gap-2">
                          <dt style={{ color: "var(--muted)" }}>Permissions</dt>
                          <dd className="flex gap-1">
                            <Badge tone={chain.canSwap ? "ok" : "bad"}>swap</Badge>
                            <Badge tone={chain.canProvideLiquidity ? "ok" : "bad"}>LP</Badge>
                          </dd>
                        </div>
                        <div className="flex justify-between gap-2">
                          <dt style={{ color: "var(--muted)" }}>Holding</dt>
                          <dd><Mono>{num(formatUnits(chain.assetBalance, decimals), 0)} {symbol}</Mono></dd>
                        </div>
                        <div className="flex justify-between gap-2">
                          <dt style={{ color: "var(--muted)" }}>Gate</dt>
                          <dd style={{ color: chain.gate === "clear" ? "var(--ok)" : "var(--bad)" }}>{chain.gate}</dd>
                        </div>
                      </dl>
                    ) : (
                      <p className="mt-1.5 text-xs" style={{ color: "var(--muted)" }}>
                        {selected.wallet ? "Chain unreachable." : "No custody account provisioned yet."}
                      </p>
                    )}
                  </div>

                  <div>
                    <div className="text-[10px] uppercase tracking-wider" style={{ color: "var(--muted)" }}>
                      What reached the chain
                    </div>
                    {selected.onchainIdentity ? (
                      <dl className="mt-1.5 space-y-1 text-xs">
                        <div className="flex justify-between gap-2">
                          <dt style={{ color: "var(--muted)" }}>Identity</dt>
                          <dd><Mono title={selected.onchainIdentity}>{short(selected.onchainIdentity)}</Mono></dd>
                        </div>
                        <div className="flex justify-between gap-2">
                          <dt style={{ color: "var(--muted)" }}>Record digest</dt>
                          <dd><Mono title={selected.claimDigest ?? ""}>
                            {selected.claimDigest ? `${selected.claimDigest.slice(0, 12)}…` : "—"}
                          </Mono></dd>
                        </div>
                        <div className="flex justify-between gap-2">
                          <dt style={{ color: "var(--muted)" }}>Approved by</dt>
                          <dd className="truncate"><Mono>{selected.approvedBy ?? "—"}</Mono></dd>
                        </div>
                      </dl>
                    ) : (
                      <p className="mt-1.5 text-xs leading-relaxed" style={{ color: "var(--muted)" }}>
                        Nothing yet. Approving writes claims carrying only this file&apos;s reference and
                        a digest of its contents — no personal data.
                      </p>
                    )}
                  </div>
                </div>
              </Panel>

              <Panel
                title="File"
                subtitle={
                  isComplete(selected)
                    ? "Complete"
                    : `Outstanding: ${missingFields(selected).map((f) => FIELD_LABELS[f] ?? f).join(", ")}`
                }
              >
                <AdminReview app={selected} missing={missingFields(selected)} complete={isComplete(selected)} />
              </Panel>

              <Panel title="File history" subtitle="Every change to this record">
                {events.length === 0 ? (
                  <p className="text-xs" style={{ color: "var(--muted)" }}>No changes recorded yet.</p>
                ) : (
                  <ol className="space-y-1.5 text-xs">
                    {events.map((e) => (
                      <li key={e.id} className="flex flex-wrap gap-x-2">
                        <Mono>{e.at.slice(0, 19).replace("T", " ")}</Mono>
                        <span>{e.action}</span>
                        <span style={{ color: "var(--muted)" }}>by {e.actor}</span>
                        {e.detail && <span style={{ color: "var(--muted)" }}>— {e.detail}</span>}
                      </li>
                    ))}
                  </ol>
                )}
              </Panel>
            </>
          )}
        </div>
      </div>

      <footer className="mt-6 text-[11px]" style={{ color: "var(--muted)" }}>
        store: <Mono>{driverName}</Mono>{!isDurable && " — resets on restart"}
      </footer>
    </main>
  );
}
