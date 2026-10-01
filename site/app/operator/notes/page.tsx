import { getStore } from "@/lib/store";
import { explorerAddress } from "@/lib/explorer";
import { loadManifest } from "@/lib/chain/manifest";
import { ISSUANCE_STEPS, SCENARIOS } from "@/lib/notes/issue";
import { advanceNoteAction, startNoteAction } from "../../actions";
import { AnchorWatch } from "../../AnchorWatch";
import { Linked, when } from "../parts";
import { NoteForm } from "./NoteForm";

export const dynamic = "force-dynamic";

export default async function Notes() {
  const notes = await getStore().listNotes();
  const chainId = loadManifest().chainId;
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
        <h3>Issue a note</h3>
        <NoteForm action={startNoteAction} scenarios={SCENARIOS.map((s) => ({ name: s.name, summary: s.summary }))} />
      </section>
    </>
  );
}
