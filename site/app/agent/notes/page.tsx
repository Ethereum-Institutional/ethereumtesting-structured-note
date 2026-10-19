import Link from "next/link";
import { getStore } from "@/lib/store";
import { ISSUANCE_STEPS, SCENARIOS } from "@/lib/notes/issue";
import { advanceNoteAction, startNoteAction, startNoteFromTermSheetAction, stopIssuanceAction } from "../../actions";
import { loadManifest } from "@/lib/chain/manifest";
import { hashOf, type TermSheet } from "@/lib/notes/termsheet";
import { ActionForm } from "../../staff/ActionForm";
import { Advance } from "../../Advance";
import { when } from "../../staff/parts";
import { NoteForm } from "./NoteForm";

export const dynamic = "force-dynamic";

/** Every note issued here, each opening on its own page; and issuing another. */
export default async function Notes() {
  const notes = await getStore().listNotes();
  const own = loadManifest().termSheet as TermSheet | undefined;
  const example = own ? hashOf(own) : null;
  return (
    <>
      <h2 id="notes">Notes</h2>
      <Advance ids={notes.filter((n) => n.status === "issuing").map((n) => n.id)} advance={advanceNoteAction} seconds={3} />
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
                  const done = n.status === "issuing" ? (n.step < 0 ? -n.step - 1 : n.step) : ISSUANCE_STEPS.length;
                  const cal = n.calendar ?? [];
                  return (
                    <tr key={n.id}>
                      <td>
                        {n.status === "issuing" ? n.name : <Link href={`/agent/notes/${n.id}`}>{n.name}</Link>}
                        <br /><span className="muted">{n.symbol}{n.isin ? `, ${n.isin}` : ""}, {n.units} units, {n.observations ?? 4} observations{n.interval ? ` every ${n.interval.value} ${n.interval.unit}` : n.spacingMinutes ? ` every ${n.spacingMinutes} minutes` : ""}</span>
                      </td>
                      <td style={{ whiteSpace: "normal", minWidth: "16rem" }}>{sc?.summary ?? (n.data.termSheet ? "Issued from its term sheet" : "")}</td>
                      <td style={{ whiteSpace: "normal", minWidth: "14rem" }}>
                        <span className={`pill ${n.status === "issued" ? "approved" : n.status === "issuing" ? "pending" : n.status === "closed" ? "" : "revoked"}`}>{n.status === "closed" ? "redeemed" : n.status}</span>
                        {n.status === "issuing" && <><br /><span className="muted">Step {done + 1} of {ISSUANCE_STEPS.length}: {ISSUANCE_STEPS[done]}</span></>}
                        {n.error && <><br /><span className="muted">{n.status === "issuing" ? `Retrying: ${n.error}` : n.error}</span></>}
                        {n.status === "issuing" && (
                          <details>
                            <summary>Stop issuing…</summary>
                            <ActionForm action={stopIssuanceAction} hidden={{ id: n.id }} label="Stop" working="Stopping…" quiet>
                              <p className="muted" style={{ margin: 0 }}>The site stops working on this note. Whatever already reached the chain stays there.</p>
                            </ActionForm>
                          </details>
                        )}
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
        <h3>Issue a note from its term sheet</h3>
        <ActionForm action={startNoteFromTermSheetAction} hidden={{}} label="Issue from the term sheet" working="Checking the term sheet and starting the issuance…">
          <p className="muted" style={{ margin: 0 }}>
            Upload the note's term sheet, as a record in the form the site publishes term sheets: its name, symbol, ISIN,
            underlyings with their Initial Levels, payoff and calendar become the note's terms, and the record is published at
            the address the note's identity carries. It is checked first: every field present or marked not applicable, this
            network, the ISIN's check digit, and dates still to come.
            {example && <> For the form, see <a href={`/term-sheets/${example}`}>the deployment's own term sheet</a>.</>}
          </p>
          <label>Term sheet file<input name="file" type="file" accept="application/json,.json" /></label>
          <label>Or paste the record<textarea name="record" rows={4} placeholder='{"schema":"structured-note-term-sheet/1","fields":{…}}' /></label>
        </ActionForm>
        <h3>Issue a demonstration note</h3>
        <NoteForm action={startNoteAction} scenarios={SCENARIOS.map((s) => ({ name: s.name, summary: s.summary }))} />
      </section>
    </>
  );
}
