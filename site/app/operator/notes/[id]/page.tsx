import Link from "next/link";
import { notFound } from "next/navigation";
import { getStore } from "@/lib/store";
import { explorerAddress, explorerTx } from "@/lib/explorer";
import { loadManifest } from "@/lib/chain/manifest";
import { routeLabel } from "@/lib/routes";
import { SCENARIOS } from "@/lib/notes/issue";
import { inventoryOf, type Placement } from "@/lib/notes/place";
import { lifecycleOf, type DateView } from "@/lib/notes/lifecycle";
import { cancelPlacementAction, claimHeldAction, determineAction, payEventAction, placeUnitsAction } from "../../../actions";
import { PendingButton } from "../../../PendingButton";
import { AutoRefresh } from "../../../AutoRefresh";
import { ActionForm } from "../../ActionForm";
import { Linked, when } from "../../parts";
import { PlaceForm, type Placeable } from "../PlaceForm";

export const dynamic = "force-dynamic";

const euros = (cents: string | bigint | number) => `€${(Number(cents) / 100).toLocaleString("en-GB", { minimumFractionDigits: 2 })}`;
const t = (s: number) => when(new Date(s * 1000).toISOString());

/** One note: its contracts, its placements and its life, date by date (ADRs 0075, 0078). */
export default async function NotePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const store = getStore();
  const n = await store.noteById(id);
  if (!n || n.status === "issuing" || n.status === "failed") notFound();
  const chainId = loadManifest().chainId;
  const sc = SCENARIOS.find((x) => x.name === n.scenario);
  const [inventory, lifecycle, admissions] = await Promise.all([
    inventoryOf(n).catch(() => n.units),
    lifecycleOf(n).catch((e) => (e as Error).message),
    store.listAdmissions(500),
  ]);
  const accounts: Placeable[] = admissions
    .filter((a) => a.status === "admitted")
    .map((a) => {
      const d = a.data as Record<string, any>;
      const s = d.assessment?.summary;
      return { id: a.id, label: `${s?.corporation ?? d.record?.legalName ?? "Account"}, ${routeLabel(a.route)}, ${String(s?.wallet ?? "").slice(0, 10)}…`, regS: Boolean(d.regS) };
    });
  const placements = ((n.data.placements ?? []) as Placement[]).slice().reverse();
  const live = typeof lifecycle === "string" ? null : lifecycle;
  // Waiting for a time to come: the page looks again by itself.
  const waiting = live && !live.closed && live.dates.some((d) => d.waiting);

  return (
    <>
      {waiting && <AutoRefresh seconds={15} />}
      <p className="muted" style={{ marginTop: 0 }}><Link href="/operator/notes">← Notes</Link></p>
      <h2 id="note" style={{ marginTop: 0 }}>{n.name}</h2>
      <section className="panel">
        <dl className="facts">
          <dt>Symbol</dt><dd>{n.symbol}</dd>
          <dt>Scenario</dt><dd>{sc?.summary}</dd>
          <dt>Status</dt><dd>{live?.closed ? "Redeemed and closed" : live?.terminated ? "Redeemed early; paying" : `Issued; ${inventory} of ${n.units} units in the Issuer's inventory`}</dd>
          <dt>Chain time</dt><dd>{live ? t(live.chainNow) : "–"}</dd>
        </dl>
        <details>
          <summary className="muted">Contracts</summary>
          <p style={{ whiteSpace: "nowrap", overflowX: "auto" }}>
            {Object.entries(n.addresses).filter(([k]) => k !== "implementation").map(([k, a]) => (
              <span key={k}>{k}: <Linked href={explorerAddress(chainId, a)}>{a}</Linked><br /></span>
            ))}
          </p>
        </details>
      </section>

      {!live?.terminated && (
        <>
          <h3 id={`place-${n.series}`}>Place units</h3>
          <section className="panel">
            <p className="muted">Each placement settles by DvP against the deposit, within 24 hours.</p>
            <PlaceForm noteId={n.id} accounts={accounts} inventory={inventory} action={placeUnitsAction} />
          </section>
        </>
      )}
      {placements.length > 0 && (
        <div className="table-wrap panel" aria-label="Placements">
          <table>
            <thead><tr><th>Trade</th><th>Account</th><th>Units</th><th>Price</th><th>Status</th><th>Transactions</th><th /></tr></thead>
            <tbody>
              {placements.map((p) => (
                <tr key={p.id}>
                  <td>{p.id}</td>
                  <td>{p.buyer.slice(0, 10)}…, {routeLabel(p.route)}</td>
                  <td>{p.units}</td>
                  <td>{euros(p.priceCents)}</td>
                  <td><span className={`pill ${p.status === "settled" ? "approved" : p.status === "offered" ? "pending" : "revoked"}`}>{p.status}</span></td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    {Object.entries(p.txs).map(([k, h]) => <span key={k}>{k}: <Linked href={explorerTx(chainId, h)}>{`${h.slice(0, 10)}…`}</Linked><br /></span>)}
                  </td>
                  <td>
                    {p.status === "offered" && (
                      <form action={cancelPlacementAction} className="actions">
                        <input type="hidden" name="noteId" value={n.id} />
                        <input type="hidden" name="tradeId" value={p.id} />
                        <PendingButton className="quiet" working="Withdrawing the offer…">Withdraw</PendingButton>
                      </form>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h3 id="lifecycle">Lifecycle</h3>
      {!live && <section className="panel"><p role="alert" className="notice err">The lifecycle could not be read: {String(lifecycle)}</p></section>}
      {live && (
        <ol className="timeline" aria-label="Lifecycle">
          {live.dates.map((d) => <DateCard key={d.index} noteId={n.id} d={d} chainId={chainId} initial={sc?.terms.initialLevels ?? []} />)}
        </ol>
      )}
    </>
  );
}

function DateCard({ noteId, d, chainId, initial }: { noteId: string; d: DateView; chainId: number; initial: number[] }) {
  const tests = [d.tests.coupon && "coupon", d.tests.mer && "early redemption", d.tests.barrier && "barrier", d.tests.isFinal && "maturity"].filter(Boolean).join(", ");
  const o = d.outcome;
  const state = d.fallsAway ? "falls-away" : d.determined && d.events.every((e) => e.closed) ? "done" : d.can.determine || d.can.pay.length ? "due" : "todo";
  return (
    <li className={`date-card ${state}`} aria-label={`Date ${d.index + 1}`} data-date={d.date} data-payment={d.paymentDate}>
      <div className="date-head">
        <strong>Date {d.index + 1}</strong>
        <span className="muted">Observation {t(d.date)} · record {t(d.recordTime).slice(11)} · payment {t(d.paymentDate).slice(11)}</span>
        <span className="muted">Tests: {tests}</span>
      </div>
      {d.fallsAway && <p className="muted">Falls away: the note redeemed early.</p>}
      {!d.fallsAway && !d.determined && d.can.determine && (
        <ActionForm action={determineAction} hidden={{ noteId, date: String(d.index) }} label={`Determine date ${d.index + 1}`} working="The Calculation Agent signs; the Determination Agent recomputes and accepts…">
          <p className="muted" style={{ margin: 0 }}>The scenario's Levels, which you may change. The Calculation Agent signs them with the outcome the contract computes.</p>
          <div className="fields">
            {d.suggested.map((l, i) => (
              <label key={i}>Underlying {i + 1} Level{initial[i] ? ` (initial ${initial[i]})` : ""}<input name="level" defaultValue={l} inputMode="numeric" required /></label>
            ))}
          </div>
        </ActionForm>
      )}
      {d.waiting && <p className="muted">{d.waiting}</p>}
      {o && (
        <p>
          Levels {d.levels?.join(", ")}: {o.couponPaid ? `coupon ${euros(o.couponPerCa)} a unit` : "no coupon"}
          {o.redeemed ? `; ${d.tests.isFinal ? "redemption" : "early redemption"} at ${euros(o.redemptionPerCa)} a unit` : ""}
          {o.breached ? "; the barrier is breached" : ""}.
          {d.model && (d.model.matches
            ? <span className="model ok"> Agrees with the payoff model.</span>
            : <span className="model bad"> Differs from the payoff model, which expects {d.model.expected.map((e) => `${e.kind} ${euros(e.perCaCents)}`).join(" and ") || "nothing"}.</span>)}
        </p>
      )}
      {d.events.map((e) => (
        <div key={e.kind} className="event">
          <p style={{ margin: 0 }}>
            <strong>{e.kind === "coupon" ? "Coupon" : "Redemption"}</strong>: {euros(e.perCaCents)} a unit.{" "}
            {e.closed ? `Paid to ${e.unitsPaid} units; closed.` : e.open ? `Open: ${e.unitsPaid} of ${e.unitsEntitled} units paid.` : "Not yet paid."}
          </p>
          {d.can.pay.includes(e.kind) && (
            <ActionForm action={payEventAction} hidden={{ noteId, date: String(d.index), kind: e.kind }} label={`Pay the ${e.kind}`} working="The servicing wallet opens the event and pays the holders of record…" />
          )}
          {e.payments.length > 0 && (
            <div className="table-wrap">
              <table>
                <thead><tr><th>Holder</th><th>Units</th><th>Amount</th><th>Transaction</th><th /></tr></thead>
                <tbody>
                  {e.payments.map((p) => (
                    <tr key={`${p.holder}-${p.tx}`}>
                      <td>{p.holder.slice(0, 10)}…</td>
                      <td>{p.units}</td>
                      <td>{euros(p.amount)}{p.held ? " (held)" : p.claimedTx ? " (claimed)" : ""}</td>
                      <td><Linked href={explorerTx(chainId, p.claimedTx ?? p.tx)}>{`${(p.claimedTx ?? p.tx).slice(0, 10)}…`}</Linked></td>
                      <td>
                        {p.held && (
                          <ActionForm action={claimHeldAction} hidden={{ noteId, id: e.id, holder: p.holder }} label="Pay what is held" working="Paying the held amount…" quiet />
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ))}
    </li>
  );
}
