import { getStore } from "@/lib/store";
import { explorerAddress } from "@/lib/explorer";
import { loadManifest } from "@/lib/chain/manifest";
import { ISSUANCE_STEPS, SCENARIOS } from "@/lib/notes/issue";
import { advanceNoteAction, cancelPlacementAction, placeUnitsAction, startNoteAction } from "../../actions";
import { routeLabel } from "@/lib/routes";
import { explorerTx } from "@/lib/explorer";
import { inventoryOf, type Placement } from "@/lib/notes/place";
import { PendingButton } from "../../PendingButton";
import { PlaceForm, type Placeable } from "./PlaceForm";
import { AnchorWatch } from "../../AnchorWatch";
import { Linked, when } from "../parts";
import { NoteForm } from "./NoteForm";

export const dynamic = "force-dynamic";

export default async function Notes() {
  const store = getStore();
  const notes = await store.listNotes();
  const chainId = loadManifest().chainId;
  const issued = notes.filter((n) => n.status === "issued");
  // The accounts units can be placed with: every admitted account, by any route.
  const accounts: Placeable[] = (await store.listAdmissions(500))
    .filter((a) => a.status === "admitted")
    .map((a) => {
      const d = a.data as Record<string, any>;
      const s = d.assessment?.summary;
      return { id: a.id, label: `${s?.corporation ?? d.record?.legalName ?? "Account"}, ${routeLabel(a.route)}, ${String(s?.wallet ?? "").slice(0, 10)}…`, regS: Boolean(d.regS) };
    });
  // The Issuer's inventory of each note: what is left to place.
  const inventories = await Promise.all(issued.map((n) => inventoryOf(n).catch(() => n.units)));
  return (
    <>
      <h2 id="notes">Notes</h2>
      <AnchorWatch ids={notes.filter((n) => n.status === "issuing").map((n) => n.id)} advance={advanceNoteAction} seconds={3} />
      <section className="panel">
        <p className="muted">
          Notes issued here run the same contracts as the note under review, each with its own gate and lifecycle
          contracts, a scenario's terms, and the calendar chosen at issuance.
        </p>
        {notes.length > 0 && (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Note</th><th>Scenario</th><th>Status</th><th>Calendar</th><th>Contracts</th></tr></thead>
              <tbody>
                {notes.map((n) => {
                  const sc = SCENARIOS.find((x) => x.name === n.scenario);
                  const done = n.status === "issuing" ? Math.abs(n.step) : ISSUANCE_STEPS.length;
                  return (
                    <tr key={n.id}>
                      <td>{n.name}<br /><span className="muted">{n.symbol}, {n.units} units, {n.observations ?? 4} observations every {n.interval ? `${n.interval.value} ${n.interval.unit}` : `${n.spacingMinutes} minutes`}</span></td>
                      <td style={{ whiteSpace: "normal", minWidth: "16rem" }}>{sc?.summary}</td>
                      <td style={{ whiteSpace: "normal", minWidth: "14rem" }}>
                        <span className={`pill ${n.status === "issued" ? "approved" : n.status === "issuing" ? "pending" : ""}`}>{n.status}</span>
                        {n.status === "issuing" && <><br /><span className="muted">Step {done + 1} of {ISSUANCE_STEPS.length}: {ISSUANCE_STEPS[done]}</span></>}
                        {n.error && <><br /><span className="muted">Retrying: {n.error}</span></>}
                      </td>
                      <td style={{ whiteSpace: "nowrap" }}>
                        {(n.calendar ?? []).map((c, i) => <span key={i}>Date {i + 1}: {when(new Date(c.date * 1000).toISOString())}<br /></span>)}
                      </td>
                      <td style={{ whiteSpace: "nowrap" }}>
                        {Object.entries(n.addresses).filter(([k]) => k !== "implementation").map(([k, a]) => (
                          <span key={k}>{k}: <Linked href={explorerAddress(chainId, a)}>{`${a.slice(0, 6)}…${a.slice(-4)}`}</Linked><br /></span>
                        ))}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {issued.map((n, i) => {
          const placements = ((n.data.placements ?? []) as Placement[]).slice().reverse();
          const euros = (c: string) => `€${(Number(c) / 100).toLocaleString("en-GB", { minimumFractionDigits: 2 })}`;
          return (
            <div key={n.id} id={`place-${n.series}`}>
              <h3>Place {n.name}</h3>
              <p className="muted">The Issuer holds {inventories[i]} of its {n.units} units. Each placement settles by DvP against the deposit, within 24 hours.</p>
              <PlaceForm noteId={n.id} accounts={accounts} inventory={inventories[i]} action={placeUnitsAction} />
              {placements.length > 0 && (
                <div className="table-wrap" style={{ marginTop: "1rem" }}>
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
            </div>
          );
        })}
        <h3>Issue a note</h3>
        <NoteForm action={startNoteAction} scenarios={SCENARIOS.map((s) => ({ name: s.name, summary: s.summary }))} />
      </section>
    </>
  );
}
