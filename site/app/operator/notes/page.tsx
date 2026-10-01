import Link from "next/link";
import { getStore } from "@/lib/store";
import { ISSUANCE_STEPS, SCENARIOS } from "@/lib/notes/issue";
import { advanceNoteAction, startNoteAction } from "../../actions";
import { AnchorWatch } from "../../AnchorWatch";
import { when } from "../parts";
import { NoteForm } from "./NoteForm";

export const dynamic = "force-dynamic";

/** Every note issued here, each opening on its own page (ADR 0078); and issuing another. */
export default async function Notes() {
  const notes = await getStore().listNotes();
  return (
    <>
      <h2 id="notes">Notes</h2>
      <AnchorWatch ids={notes.filter((n) => n.status === "issuing").map((n) => n.id)} advance={advanceNoteAction} seconds={3} />
      <section className="panel">
        <p className="muted">
          Notes issued here run the same contracts as the note under review, each with its own gate and lifecycle
          contracts, a scenario's terms, and the calendar chosen at issuance. Open a note to place it, determine its
          dates and pay it.
        </p>
        {notes.length > 0 && (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Note</th><th>Scenario</th><th>Status</th><th>Calendar</th></tr></thead>
              <tbody>
                {notes.map((n) => {
                  const sc = SCENARIOS.find((x) => x.name === n.scenario);
                  const done = n.status === "issuing" ? Math.abs(n.step) : ISSUANCE_STEPS.length;
                  const cal = n.calendar ?? [];
                  return (
                    <tr key={n.id}>
                      <td>
                        {n.status === "issuing" ? n.name : <Link href={`/operator/notes/${n.id}`}>{n.name}</Link>}
                        <br /><span className="muted">{n.symbol}, {n.units} units, {n.observations ?? 4} observations every {n.interval ? `${n.interval.value} ${n.interval.unit}` : `${n.spacingMinutes} minutes`}</span>
                      </td>
                      <td style={{ whiteSpace: "normal", minWidth: "16rem" }}>{sc?.summary}</td>
                      <td style={{ whiteSpace: "normal", minWidth: "14rem" }}>
                        <span className={`pill ${n.status === "issued" ? "approved" : n.status === "issuing" ? "pending" : n.status === "closed" ? "" : "revoked"}`}>{n.status === "closed" ? "redeemed" : n.status}</span>
                        {n.status === "issuing" && <><br /><span className="muted">Step {done + 1} of {ISSUANCE_STEPS.length}: {ISSUANCE_STEPS[done]}</span></>}
                        {n.error && <><br /><span className="muted">Retrying: {n.error}</span></>}
                      </td>
                      <td style={{ whiteSpace: "nowrap" }}>
                        {cal.length > 0 && <>Date 1: {when(new Date(cal[0].date * 1000).toISOString())}<br />Date {cal.length}: {when(new Date(cal.at(-1)!.date * 1000).toISOString())}</>}
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
