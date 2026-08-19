import Link from "next/link";
import { formatUnits } from "viem";
import { seedIfEmpty } from "@/lib/db/seed";
import { listApplications, getApplication, listEvents, driverName, isDurable } from "@/lib/db";
import { isComplete, missingFields, FIELD_LABELS, STATUS_LABEL, type ApplicationStatus } from "@/lib/db/types";
import { applicantStatus } from "@/lib/applications";
import { addresses } from "@/lib/chain";
import { Panel, Badge, Mono, short, num } from "@/components/ui";
import { StatusBadge, STATUS_TONE } from "@/components/StatusBadge";
import { AdminEditor } from "@/components/AdminEditor";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function AdminPage({
  searchParams,
}: {
  searchParams: Promise<{ id?: string }>;
}) {
  const { id } = await searchParams;

  let apps: Awaited<ReturnType<typeof listApplications>> = [];
  let seedError: string | null = null;
  try {
    await seedIfEmpty();
    apps = await listApplications();
  } catch (e: any) {
    seedError = String(e?.message ?? e).slice(0, 200);
  }

  const selected = id ? await getApplication(id).catch(() => null) : null;
  const events = selected ? await listEvents(selected.id).catch(() => []) : [];

  let chain: Awaited<ReturnType<typeof applicantStatus>> | null = null;
  let decimals = 18;
  let symbol = "APACDC";
  if (selected) {
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

  return (
    <main className="mx-auto max-w-[1400px] p-5 pb-16">
      <nav className="mb-6 flex flex-wrap items-center gap-3 text-xs">
        <Link href="/" className="rounded border px-2.5 py-1 transition-opacity hover:opacity-80"
          style={{ borderColor: "var(--line)", color: "var(--muted)" }}>
          &larr; Live console
        </Link>
        <Link href="/portal" className="rounded border px-2.5 py-1 transition-opacity hover:opacity-80"
          style={{ borderColor: "var(--line)", color: "var(--muted)" }}>
          Investor view
        </Link>
        <span style={{ color: "var(--muted)" }}>You are on: compliance admin</span>
        <span className="ml-auto" style={{ color: "var(--muted)" }}>
          store: <Mono>{driverName}</Mono>{!isDurable && " — resets on restart"}
        </span>
      </nav>

      <header className="mb-5">
        <h1 className="text-xl font-semibold tracking-tight">Onboarding administration</h1>
        <p className="mt-1 text-xs" style={{ color: "var(--muted)" }}>
          The KYC provider&apos;s book. Edit any field, sign a file off, and the investor&apos;s
          on-chain permission changes on the next block. All applicant details are fictional.
        </p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {Object.entries(counts).map(([k, v]) => (
            <Badge key={k} tone={STATUS_TONE[k as ApplicationStatus] ?? "muted"}>
              {v} {STATUS_LABEL[k as ApplicationStatus] ?? k}
            </Badge>
          ))}
        </div>
        {seedError && (
          <p className="mt-2 rounded border px-3 py-2 text-xs"
            style={{ borderColor: "rgba(255,107,107,.35)", color: "var(--bad)" }}>
            Store unavailable: {seedError}
          </p>
        )}
      </header>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,340px)_1fr]">
        <Panel title="Queue" subtitle={`${apps.length} applications`}>
          <ul className="-mx-4 divide-y" style={{ borderColor: "var(--line)" }}>
            {apps.map((a) => {
              const isSel = selected?.id === a.id;
              const gaps = missingFields(a).length;
              return (
                <li key={a.id} style={{ borderColor: "var(--line)" }} className="border-t first:border-0">
                  <Link
                    href={`/portal/admin?id=${a.id}`}
                    className="block px-4 py-2.5 transition-colors"
                    style={{ background: isSel ? "var(--panel-2)" : "transparent" }}
                  >
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="text-xs font-medium">{a.applicantName}</span>
                      <StatusBadge status={a.status} />
                    </div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[10px]" style={{ color: "var(--muted)" }}>
                      <Mono>{a.reference}</Mono>
                      <span>{a.classification}</span>
                      {gaps > 0 && <span style={{ color: "var(--bad)" }}>{gaps} outstanding</span>}
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        </Panel>

        <div className="space-y-4">
          {!selected ? (
            <Panel title="No file selected" subtitle="Pick an application from the queue">
              <p className="text-xs" style={{ color: "var(--muted)" }}>
                Dave Whitcombe&apos;s file is the one with an outstanding item.
              </p>
            </Panel>
          ) : (
            <>
              <Panel
                title={`${selected.reference} — ${selected.applicantName}`}
                subtitle={`submitted ${selected.submittedAt ?? "—"} · wallet ${short(selected.wallet)}`}
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
                      <p className="mt-1.5 text-xs" style={{ color: "var(--muted)" }}>Chain unreachable.</p>
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
                          <dd><Mono title={selected.claimDigest ?? ""}>{selected.claimDigest ? `${selected.claimDigest.slice(0, 12)}…` : "—"}</Mono></dd>
                        </div>
                        <div className="flex justify-between gap-2">
                          <dt style={{ color: "var(--muted)" }}>Approved</dt>
                          <dd><Mono>{selected.approvedAt?.slice(0, 10) ?? "—"}</Mono></dd>
                        </div>
                      </dl>
                    ) : (
                      <p className="mt-1.5 text-xs" style={{ color: "var(--muted)" }}>
                        Nothing yet. Approving writes a claim carrying only this file&apos;s reference
                        and a digest of its contents.
                      </p>
                    )}
                  </div>
                </div>
              </Panel>

              <Panel
                title="File"
                subtitle={
                  isComplete(selected)
                    ? "Complete — ready for sign-off"
                    : `Outstanding: ${missingFields(selected).map((f) => FIELD_LABELS[f]).join(", ")}`
                }
              >
                <AdminEditor
                  app={selected}
                  missing={missingFields(selected)}
                  complete={isComplete(selected)}
                />
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
    </main>
  );
}
