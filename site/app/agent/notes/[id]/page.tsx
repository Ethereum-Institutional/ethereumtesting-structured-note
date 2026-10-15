import Link from "next/link";
import { notFound } from "next/navigation";
import { getStore } from "@/lib/store";
import { explorerAddress, explorerTx } from "@/lib/explorer";
import { loadManifest } from "@/lib/chain/manifest";
import { routeLabel } from "@/lib/routes";
import { custodianOf, dataOf } from "@/lib/identity/onboarding";
import { SCENARIOS } from "@/lib/notes/issue";
import { holdersOf, inventoryOf, lockedSettlement, offersOf, totalOf, type Arranged, type Placement } from "@/lib/notes/place";
import { lifecycleOf, type DateView } from "@/lib/notes/lifecycle";
import { closeOutOf, type CloseOut } from "@/lib/notes/closeout";
import {
  arrangeTradeAction,
  buybackAction,
  cancelInventoryAction,
  cancelOfferAction,
  claimHeldAction,
  determineAction,
  payEventAction,
  placeUnitsAction,
  releaseExpiredAction,
  takeForCustodyAction,
  withdrawArrangedAction,
} from "../../../actions";
import { AutoRefresh } from "../../../AutoRefresh";
import { ActionForm } from "../../../staff/ActionForm";
import { Linked, when } from "../../../staff/parts";
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
  const locked = lockedSettlement(n);
  const [inventory, total, lifecycle, admissions, offers, units] = await Promise.all([
    inventoryOf(n).catch(() => n.units),
    totalOf(n).catch(() => n.units),
    lifecycleOf(n).catch((e) => (e as Error).message),
    store.listAdmissions(500),
    locked ? offersOf(n).catch(() => []) : Promise.resolve([]),
    locked ? holdersOf(n).catch(() => new Map<string, bigint>()) : Promise.resolve(new Map<string, bigint>()),
  ]);
  const accounts: Placeable[] = admissions
    .filter((a) => a.status === "onboarded")
    .map((a) => {
      const d = dataOf(a);
      return { id: a.id, label: `${d.request?.organisation ?? "Account"}, ${routeLabel(a.route)}, ${String(d.wallet ?? "").slice(0, 10)}…`, regS: d.note?.status === "approved" || a.route === "existing-identity" };
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
  // The close-out statement, once the note has redeemed (S-33).
  const closeOut = live?.terminated ? await closeOutOf(n).catch((e) => (e as Error).message) : null;
  // Waiting for a time to come: the page looks again by itself.
  const waiting = live && !live.closed && live.dates.some((d) => d.waiting);

  return (
    <>
      {waiting && <AutoRefresh seconds={15} />}
      <p className="muted" style={{ marginTop: 0 }}><Link href="/agent/notes">← Notes</Link></p>
      <h2 id="note" style={{ marginTop: 0 }}>{n.name}</h2>
      <section className="panel">
        <dl className="facts">
          <dt>Symbol</dt><dd>{n.symbol}</dd>
          <dt>Scenario</dt><dd>{sc?.summary}</dd>
          <dt>Status</dt><dd>{live?.closed ? "Redeemed and closed" : live?.terminated ? "Redeemed early; paying" : `Issued; ${inventory} of ${total} units in the Issuer's inventory`}</dd>
          {!locked && <><dt>Trading</dt><dd>Issued before locked settlement (ADR 0081): placed only, with no transfers or buy-backs.</dd></>}
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
                    {accounts.map((a) => <option key={a.id} value={a.id}>{a.label}{a.regS ? "" : " (not eligible for the note)"}</option>)}
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
          {live.dates.map((d) => <DateCard key={d.index} noteId={n.id} d={d} chainId={chainId} initial={sc?.terms.initialLevels ?? []} />)}
        </ol>
      )}

      <h3 id="close-out">Close-out</h3>
      {!closeOut && <section className="panel"><p className="muted" style={{ margin: 0 }}>Shown once the note has redeemed: the statement that every position is at zero (S-33).</p></section>}
      {typeof closeOut === "string" && <section className="panel"><p role="alert" className="notice err">The close-out could not be read: {closeOut}</p></section>}
      {closeOut && typeof closeOut !== "string" && <CloseOutPanel noteId={n.id} c={closeOut} />}
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

function CloseOutPanel({ noteId, c }: { noteId: string; c: CloseOut }) {
  return (
    <section className="panel" aria-label="Close-out">
      <p className={c.closed ? "notice ok" : "notice err"} role="status" style={{ marginTop: 0 }}>
        {c.closed
          ? `Closed: every position is at zero. Read from the chain at block ${c.block}, ${t(Date.parse(c.at) / 1000)}.`
          : `Not closed: ${c.checks.filter((x) => !x.ok).length} check(s) fail, as of block ${c.block}.`}
      </p>
      <ul className="plain" aria-label="Close-out checks">
        {c.checks.map((x) => (
          <li key={x.label}><strong>{x.ok ? "✓" : "✗"} {x.label}.</strong> <span className="muted">{x.detail}</span></li>
        ))}
      </ul>
      <div className="table-wrap" style={{ marginTop: "1rem" }}>
        <table aria-label="Positions">
          <thead><tr><th>Account</th><th>Units in</th><th>Units out</th><th>Balance</th><th>Coupons</th><th>Redemption</th><th>Held</th></tr></thead>
          <tbody>
            {c.positions.map((p) => (
              <tr key={p.account}>
                <td>{p.account.slice(0, 10)}…</td>
                <td>{p.unitsIn}</td>
                <td>{p.unitsOut}</td>
                <td>{p.balance}</td>
                <td>{euros(p.couponCents)}</td>
                <td>{euros(p.redemptionCents)}</td>
                <td>{euros(p.heldCents)}</td>
              </tr>
            ))}
            <tr>
              <td><strong>Total</strong></td><td /><td /><td><strong>{c.totals.units}</strong></td>
              <td><strong>{euros(c.totals.couponCents)}</strong></td><td><strong>{euros(c.totals.redemptionCents)}</strong></td><td><strong>{euros(c.totals.heldCents)}</strong></td>
            </tr>
          </tbody>
        </table>
      </div>
      <p className="muted" style={{ marginBottom: 0 }}>
        <a href={`/agent/notes/${noteId}/close-out`} download>Download the statement (JSON)</a>, with every figure above, for the evidence pack. Anyone with the chain can reproduce it from the block it was read at.
      </p>
    </section>
  );
}
