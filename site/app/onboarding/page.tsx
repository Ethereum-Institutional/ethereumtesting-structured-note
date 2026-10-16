import { getStore } from "@/lib/store";
import { ROUTE_LABEL, dataOf } from "@/lib/identity/onboarding";
import { claimState, participantOf } from "@/lib/identity/participants";
import { decideNoteAction } from "../actions";
import { ActionForm } from "../staff/ActionForm";
import { when } from "../staff/parts";
import { Address } from "../Address";
import { accountNamer } from "@/lib/identity/names";

export const dynamic = "force-dynamic";

/**
 * Requests for the note (ADR 0089). The onboarding agent sees the client's answers and that the
 * bank's claim stands, which the client consented to it relying on, and never the bank's record.
 */
export default async function NoteRequests() {
  const nameOf = await accountNamer();
  const admissions = await getStore().listAdmissions(500);
  const waiting = admissions.filter((a) => a.status === "onboarded" && dataOf(a).note?.status === "requested");
  const rows = await Promise.all(waiting.map(async (a) => ({ a, p: await participantOf(a) })));
  return (
    <>
      <h2 id="requests">Requests for the notes</h2>
      {rows.length === 0 && <p className="muted panel">No client is waiting for access to the notes.</p>}
      {rows.map(({ a, p }) => {
        const d = dataOf(a);
        const bank = p ? claimState(p.claims.deposit) : null;
        return (
          <section className="panel" key={a.id}>
            <p className="eyebrow">{ROUTE_LABEL[a.route]}, asked {when(d.note!.requestedAt)}</p>
            <h3 style={{ margin: "0.25rem 0 1rem" }}>{nameOf(a)}</h3>
            <dl className="facts">
              <dt>Wallet</dt><dd><Address value={d.wallet} /></dd>
              <dt>Identity</dt><dd><Address value={d.identity} /></dd>
              <dt>The bank's claim</dt><dd>{bank ? <span className={`pill ${bank.pill}`}>{bank.label}</span> : "unreadable"}</dd>
              <dt>Not a U.S. person</dt><dd>{d.note!.answers.notUsPerson ? "Declared" : "Not declared"}</dd>
              <dt>Investor class declared</dt><dd>{d.note!.answers.investorClass || "none"}</dd>
              <dt>Relies on the bank's KYB</dt><dd>{d.note!.answers.relyOnBankKyb ? "With the client's consent" : "No"}</dd>
            </dl>
            <ActionForm action={decideNoteAction} hidden={{ id: a.id, decision: "approve" }} label="Approve for the notes" working="Adding the note claim…">
              <p className="muted">Adds the onboarding agent's claim to the client's identity, carrying the hash of this decision's record. Every note issued under the programme accepts the wallet at once.</p>
            </ActionForm>
            <details>
              <summary>Decline…</summary>
              <ActionForm action={decideNoteAction} hidden={{ id: a.id, decision: "decline" }} label="Decline" working="Declining…" quiet>
                <label>Reason<input name="reason" maxLength={500} /></label>
              </ActionForm>
            </details>
          </section>
        );
      })}
    </>
  );
}
