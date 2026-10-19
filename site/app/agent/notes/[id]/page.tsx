import Link from "next/link";
import { notFound } from "next/navigation";
import { getStore, type Job } from "@/lib/store";
import { jobsFor } from "@/lib/jobs";
import { explorerTx } from "@/lib/explorer";
import { loadManifest } from "@/lib/chain/manifest";
import { routeLabel } from "@/lib/routes";
import { custodianOf, dataOf } from "@/lib/identity/onboarding";
import { SCENARIOS } from "@/lib/notes/issue";
import { holdersOf, inventoryOf, lockedSettlement, offersOf, totalOf, type Arranged, type Placement } from "@/lib/notes/place";
import { lifecycleOf, type DateView } from "@/lib/notes/lifecycle";
import { statementOf } from "@/lib/notes/reconcile";
import { noteOnRecord } from "@/lib/notes/registry";
import { StatementPanel } from "../../reconciliation/StatementPanel";
import {
  arrangeTradeAction,
  buybackAction,
  cancelInventoryAction,
  cancelOfferAction,
  claimHeldAction,
  determineAction,
  payEventAction,
  placeUnitsAction,
  stopJobAction,
  approveJobAction,
  rejectJobAction,
  releaseExpiredAction,
  takeForCustodyAction,
  withdrawArrangedAction,
} from "../../../actions";
import { AutoRefresh } from "../../../AutoRefresh";
import { ActionForm } from "../../../staff/ActionForm";
import { Linked, when } from "../../../staff/parts";
import { PlaceForm, type Placeable } from "../PlaceForm";
import { Address } from "../../../Address";
import { accountNamer } from "@/lib/identity/names";

export const dynamic = "force-dynamic";

const euros = (cents: string | bigint | number) => `€${(Number(cents) / 100).toLocaleString("en-GB", { minimumFractionDigits: 2 })}`;
const t = (s: number) => when(new Date(s * 1000).toISOString());

/** One note: its contracts, its placements and its life, date by date. */
export default async function NotePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const store = getStore();
  const n = await store.noteById(id);
  if (!n || n.status === "issuing" || n.status === "failed") notFound();
  const chainId = loadManifest().chainId;
  const sc = SCENARIOS.find((x) => x.name === n.scenario);
  const locked = lockedSettlement(n);
  const [inventory, total, lifecycle, admissions, offers, units, jobs] = await Promise.all([
    inventoryOf(n).catch(() => n.units),
    totalOf(n).catch(() => n.units),
    lifecycleOf(n).catch((e) => (e as Error).message),
    store.listAdmissions(500),
    locked ? offersOf(n).catch(() => []) : Promise.resolve([]),
    locked ? holdersOf(n).catch(() => new Map<string, bigint>()) : Promise.resolve(new Map<string, bigint>()),
    jobsFor(n.id),
  ]);
  const nameOf = await accountNamer();
  const accounts: Placeable[] = admissions
    .filter((a) => a.status === "onboarded")
    .map((a) => {
      const d = dataOf(a);
      return { id: a.id, label: `${nameOf(a)}, ${routeLabel(a.route)}, ${String(d.wallet ?? "").slice(0, 10)}…`, regS: d.note?.status === "approved" || a.route === "existing-identity" };
    });
  const legacy = ((n.data.placements ?? []) as Placement[]).slice().reverse();
  const arranged = ((n.data.arranged ?? []) as Arranged[]).filter((x) => x.status === "awaiting-seller");
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const label = (id: string | null) => (id === "issuer" ? "Issuer" : id ? byId.get(id)?.label ?? id : "–");
  const party = (address: string | null, id: string | null) => (id ? label(id) : address ? `${address.slice(0, 10)}…` : "–");
  const holders = accounts.filter((a) => (units.get(a.id) ?? 0n) > 0n).map((a) => ({ ...a, units: String(units.get(a.id)) }));
  const custodyIds = new Set(admissions.filter((a) => custodianOf(a) !== null && a.status === "onboarded").map((a) => a.id));
  const custody = accounts.filter((a) => custodyIds.has(a.id));
  const live = typeof lifecycle === "string" ? null : lifecycle;
  // The reconciliation statement now, which closes the note once it has redeemed (S-33).
  const rec = n.addresses.note ? await noteOnRecord(n.addresses.note).catch(() => null) : null;
  const statement = rec ? await statementOf(rec).catch((e) => (e as Error).message) : null;
  // Waiting for a time to come: the page looks again by itself.
  const waiting = live && !live.closed && live.dates.some((d) => d.waiting);
  // A payment running in the background: the page follows it.
  const running = jobs.some((j) => j.state === "queued");

  return (
    <>
      {running ? <AutoRefresh seconds={4} /> : waiting && <AutoRefresh seconds={15} />}
      <p className="muted" style={{ marginTop: 0 }}><Link href="/agent/notes">← Notes</Link></p>
      <h2 id="note" style={{ marginTop: 0 }}>{n.name}</h2>
      <section className="panel">
        <dl className="facts">
          <dt>Symbol</dt><dd>{n.symbol}</dd>
          {typeof n.data.series === "number" && <><dt>Series</dt><dd>{n.data.series}, as the note factory numbered it</dd></>}
          {n.isin && <><dt>ISIN</dt><dd>{n.isin}</dd></>}
          <dt>Scenario</dt><dd>{sc?.summary}</dd>
          <dt>Status</dt><dd>{live?.closed ? "Redeemed and closed" : live?.terminated ? "Redeemed early; paying" : `Issued; ${inventory} of ${total} units in the Issuer's inventory`}</dd>
          {!locked && <><dt>Trading</dt><dd>Issued before locked settlement existed: its units can be placed, but not transferred or bought back through the site.</dd></>}
          <dt>Chain time</dt><dd>{live ? t(live.chainNow) : "–"}</dd>
        </dl>
        <details>
          <summary className="muted">Contracts</summary>
          <p style={{ whiteSpace: "nowrap", overflowX: "auto" }}>
            {Object.entries(n.addresses).filter(([k]) => k !== "implementation").map(([k, a]) => (
              <span key={k}>{k}: <Address value={a} /><br /></span>
            ))}
          </p>
        </details>
      </section>

      {locked && n.status === "issued" && !live?.terminated && (
        <>
          <h3 id={`place-${n.series}`}>Place units</h3>
          <section className="panel">
            <p className="muted">The Issuer offers units from its inventory to a named account, locked until accepted, within 24 hours.</p>
            <PlaceForm noteId={n.id} accounts={accounts} inventory={inventory} action={placeUnitsAction} />
          </section>

          <h3 id="trade">Transfers and buy-backs</h3>
          <section className="panel">
            <details>
              <summary>Arrange a transfer…</summary>
              <ActionForm action={arrangeTradeAction} hidden={{ noteId: n.id }} label="Arrange" working="Each custody side acts through the custodian; a wallet acts in MetaMask…">
                <p className="muted" style={{ margin: 0 }}>
                  As the clients' broker: the seller's units, or a custody buyer's price, are locked when the offer is made. A
                  client's own wallet makes or accepts its side on its Notes page. Leave the buyer open for an offer any approved client may take.
                </p>
                <div className="fields">
                  <label>Seller<select name="seller" required defaultValue="">
                    <option value="" disabled>Choose the seller…</option>
                    {holders.map((a) => <option key={a.id} value={a.id}>{a.label} ({a.units} units)</option>)}
                  </select></label>
                  <label>Buyer<select name="buyer" required defaultValue="">
                    <option value="" disabled>Choose the buyer…</option>
                    <option value="open">Open: any approved client</option>
                    {accounts.map((a) => <option key={a.id} value={a.id}>{a.label}{a.regS ? "" : " (not eligible for the notes)"}</option>)}
                  </select></label>
                  <label>Units<input name="units" type="number" min={1} step={1} defaultValue={1} required /></label>
                  <label>Price a unit (€)<input name="price" inputMode="decimal" defaultValue="1000.00" required /></label>
                </div>
              </ActionForm>
            </details>
            <details style={{ marginTop: "0.75rem" }}>
              <summary>Buy back units…</summary>
              <ActionForm action={buybackAction} hidden={{ noteId: n.id }} label="Offer to buy back" working="The Issuer's price is held until the holder accepts…">
                <p className="muted" style={{ margin: 0 }}>The Issuer offers to buy units from a holder; they return to its inventory, to place again or cancel (S-13).</p>
                <div className="fields">
                  <label>Holder<select name="admission" required defaultValue="">
                    <option value="" disabled>Choose the holder…</option>
                    {holders.map((a) => <option key={a.id} value={a.id}>{a.label} ({a.units} units)</option>)}
                  </select></label>
                  <label>Units<input name="units" type="number" min={1} step={1} defaultValue={1} required /></label>
                  <label>Price a unit (€)<input name="price" inputMode="decimal" defaultValue="1000.00" required /></label>
                </div>
              </ActionForm>
            </details>
            <details style={{ marginTop: "0.75rem" }}>
              <summary>Cancel units from the inventory…</summary>
              <ActionForm action={cancelInventoryAction} hidden={{ noteId: n.id }} label="Cancel units" working="Burning units from the Issuer's inventory…">
                <p className="muted" style={{ margin: 0 }}>
                  Reduces the note's total, now {total} units. Only units in the Issuer's inventory and not offered can be
                  cancelled (S-14). The note under review needs a Tier 2 approval for this; a note issued here, the Agent's key.
                </p>
                <div className="fields"><label>Units<input name="units" type="number" min={1} step={1} defaultValue={1} required /></label></div>
              </ActionForm>
            </details>
          </section>
        </>
      )}

      {locked && (offers.length > 0 || arranged.length > 0) && (
        <div className="table-wrap panel" aria-label="Offers">
          <table>
            <thead><tr><th>Offer</th><th>Kind</th><th>Seller</th><th>Buyer</th><th>Units</th><th>Price</th><th>Open until</th><th>Status</th><th /></tr></thead>
            <tbody>
              {arranged.map((x) => (
                <tr key={x.ref}>
                  <td>{x.ref}</td>
                  <td>Transfer, arranged</td>
                  <td>{label(x.seller)}</td>
                  <td>{x.buyer ? label(x.buyer) : "Open"}</td>
                  <td>{x.units}</td>
                  <td>{euros(x.priceCents)}</td>
                  <td />
                  <td><span className="pill pending">awaiting the seller</span></td>
                  <td><ActionForm action={withdrawArrangedAction} hidden={{ noteId: n.id, ref: x.ref }} label="Withdraw" working="Withdrawing…" quiet /></td>
                </tr>
              ))}
              {offers.map((o) => {
                const expired = o.status === "offered" && live && o.deadline < live.chainNow;
                const ours = o.proposerAdmission === "issuer" || o.counterpartyAdmission === "issuer" || custodyIds.has(o.proposerAdmission ?? "") || (o.counterparty !== null && custodyIds.has(o.counterpartyAdmission ?? ""));
                return (
                  <tr key={o.id}>
                    <td><Linked href={explorerTx(chainId, o.settledTx ?? o.offeredTx)}>{o.id}</Linked></td>
                    <td>{o.kind === "placement" ? "Placement" : o.kind === "buy-back" ? "Buy-back" : "Transfer"}{o.counterparty ? "" : ", open"}</td>
                    <td>{party(o.seller, o.side === "sell" ? o.proposerAdmission : o.counterpartyAdmission)}</td>
                    <td>{o.buyer ? party(o.buyer, o.side === "buy" ? o.proposerAdmission : o.counterpartyAdmission) : "Open"}</td>
                    <td>{o.units}</td>
                    <td>{euros(o.priceCents)}</td>
                    <td>{t(o.deadline)}</td>
                    <td><span className={`pill ${o.status === "settled" ? "approved" : o.status === "offered" ? (expired ? "revoked" : "pending") : ""}`}>{expired ? "expired" : o.status}</span></td>
                    <td>
                      {o.status === "offered" && ours && !expired && (
                        <ActionForm action={cancelOfferAction} hidden={{ noteId: n.id, offerId: o.id }} label="Withdraw" working="Withdrawing the offer…" quiet />
                      )}
                      {o.status === "offered" && !o.counterparty && !expired && custody.length > 0 && (
                        <ActionForm action={takeForCustodyAction} hidden={{ noteId: n.id, offerId: o.id }} label="Take for the account" working="The custodian takes the offer…" quiet>
                          <select name="admission" required defaultValue="" aria-label="Custody account">
                            <option value="" disabled>Custody account…</option>
                            {custody.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
                          </select>
                        </ActionForm>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {offers.some((o) => o.status === "offered" && live && o.deadline < live.chainNow) && (
            <ActionForm action={releaseExpiredAction} hidden={{ noteId: n.id }} label="Release expired offers" working="Releasing the offers' locks…" quiet />
          )}
        </div>
      )}

      {!locked && legacy.length > 0 && (
        <div className="table-wrap panel" aria-label="Placements">
          <table>
            <thead><tr><th>Trade</th><th>Account</th><th>Units</th><th>Price</th><th>Status</th></tr></thead>
            <tbody>
              {legacy.map((p) => (
                <tr key={p.id}><td>{p.id}</td><td>{p.buyer.slice(0, 10)}…, {routeLabel(p.route)}</td><td>{p.units}</td><td>{euros(p.priceCents)}</td><td>{p.status}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h3 id="lifecycle">Lifecycle</h3>
      {!live && <section className="panel"><p role="alert" className="notice err">The lifecycle could not be read: {String(lifecycle)}</p></section>}
      {live && (
        <ol className="timeline" aria-label="Lifecycle">
          {live.dates.map((d) => <DateCard key={d.index} noteId={n.id} d={d} chainId={chainId} initial={sc?.terms.initialLevels ?? []} jobs={jobs.filter((j) => j.data.date === d.index)} />)}
        </ol>
      )}

      <h3 id="reconciliation">Reconciliation</h3>
      {!statement && <section className="panel"><p className="muted" style={{ margin: 0 }}>The statement is read once the note is issued.</p></section>}
      {typeof statement === "string" && <section className="panel"><p role="alert" className="notice err">The statement could not be read: {statement}</p></section>}
      {statement && typeof statement !== "string" && rec && (
        <>
          <StatementPanel s={statement} downloads={{ json: `/agent/reconciliation/${rec.token}/statement?asAt=now&format=json`, csv: `/agent/reconciliation/${rec.token}/statement?asAt=now&format=csv` }} />
          <p className="muted">As at the close of any day since issuance: <a href={`/agent/reconciliation/${rec.token}`}>the note's statements by day</a>.</p>
        </>
      )}
    </>
  );
}

function DateCard({ noteId, d, chainId, initial, jobs }: { noteId: string; d: DateView; chainId: number; initial: number[]; jobs: Job[] }) {
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
      <Approval jobs={jobs.filter((j) => j.kind === "determination")} />
      {!d.fallsAway && !d.determined && d.can.determine && !jobs.some((j) => j.kind === "determination" && (j.state === "awaiting approval" || j.state === "queued")) && (
        <ActionForm action={determineAction} hidden={{ noteId, date: String(d.index) }} label={`Determine date ${d.index + 1}`} working="Proposing the determination…">
          <p className="muted" style={{ margin: 0 }}>
            The scenario's Levels, which you may change, and where they came from. A second Calculation Agent approves them; the
            Calculation Agent then signs them with the outcome the contract computes.
          </p>
          <div className="fields">
            {d.suggested.map((l, i) => (
              <label key={i}>Underlying {i + 1} Level{initial[i] ? ` (initial ${initial[i]})` : ""}<input name="level" defaultValue={l} inputMode="numeric" required /></label>
            ))}
          </div>
          <label title="The fixing page, data vendor or exchange each Level was read from, kept with the determination.">
            Source of the Levels<input name="source" maxLength={200} placeholder="e.g. official closing levels, exchange fixing page" />
          </label>
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
          <Approval jobs={jobs.filter((j) => j.kind === "payment" && j.data.event === e.kind)} />
          <PaymentJob job={jobs.find((j) => j.kind === "payment" && j.data.event === e.kind && j.state !== "awaiting approval")} closed={e.closed} />
          {d.can.pay.includes(e.kind) && !jobs.some((j) => j.kind === "payment" && j.data.event === e.kind && (j.state === "queued" || j.state === "awaiting approval")) && (
            <ActionForm action={payEventAction} hidden={{ noteId, date: String(d.index), kind: e.kind }} label={`Pay the ${e.kind}`} working="Starting the payment…" />
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


/** A payment's run in the background: where it has got to, why it is waiting, and a way to stop it. */
function PaymentJob({ job, closed }: { job?: Job; closed: boolean }) {
  if (!job || job.state === "done" || (closed && job.state !== "failed")) return null;
  const sent = ((job.data.txs as string[]) ?? []).length;
  if (job.state === "queued") {
    return (
      <div className="notice ok" role="status">
        Paying in the background{job.data.step ? `: ${String(job.data.step)}` : ""}; {sent} transaction{sent === 1 ? "" : "s"} sent so far.
        {job.error && <> The last step failed and will be tried again: {job.error}</>}
        <ActionForm action={stopJobAction} hidden={{ id: job.id }} label="Stop paying" working="Stopping…" quiet />
      </div>
    );
  }
  return <p role="alert" className="notice err">The last payment run {job.state === "stopped" ? "was stopped" : "failed"}{job.error ? `: ${job.error}` : "."} Pay again to carry on from where it stopped.</p>;
}

/**
 * Four eyes: a determination or a payment a colleague proposed, waiting for a second person with
 * the same duty; and, once approved, who approved it.
 */
function Approval({ jobs }: { jobs: Job[] }) {
  const j = jobs.find((x) => x.state === "awaiting approval") ?? jobs.find((x) => x.approval && x.state !== "stopped");
  if (!j) return null;
  const what = j.kind === "determination" ? `Levels ${(j.data.levels as string[]).join(", ")}${j.data.source ? ` (${String(j.data.source)})` : ""}: ${String(j.data.outcome ?? "")}` : `the ${String(j.data.event)}`;
  if (j.state !== "awaiting approval") {
    return (
      <p className="muted" style={{ margin: "0.25rem 0" }}>
        {j.kind === "determination" ? "Determination" : "Payment"} proposed by {j.by}, approved by {j.approval!.by}{j.approval!.automatic ? ", as this deployment allows" : ""}.
      </p>
    );
  }
  return (
    <div className="notice" role="status" aria-label="Awaiting approval">
      <p style={{ margin: 0 }}>
        <strong>Awaiting a second approver.</strong> {j.by} proposed {j.kind === "determination" ? "determining this date from" : "paying"} {what}.
        Another {j.kind === "determination" ? "Calculation Agent" : "payments"} colleague approves it before anything is sent.
      </p>
      <div className="actions">
        <ActionForm action={approveJobAction} hidden={{ id: j.id }} label="Approve" working="Approving…" />
        <ActionForm action={rejectJobAction} hidden={{ id: j.id }} label="Decline" working="Declining…" quiet>
          <label>Reason<input name="reason" required maxLength={300} /></label>
        </ActionForm>
      </div>
    </div>
  );
}
