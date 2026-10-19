import { ROUTE_LABEL, dataOf } from "@/lib/identity/onboarding";
import { claimState, participants } from "@/lib/identity/participants";
import { revokeNoteAction } from "../../actions";
import { ActionForm } from "../../staff/ActionForm";
import { Address } from "../../Address";
import { accountNamer } from "@/lib/identity/names";

export const dynamic = "force-dynamic";

/** The wallets the onboarding agent vouched for the notes, and its claim on each, revoked here. */
export default async function VouchedFor() {
  const nameOf = await accountNamer();
  const rows = await participants((a) => Boolean(dataOf(a).note && dataOf(a).note!.status !== "requested") || a.route === "existing-identity");
  return (
    <>
      <h2 id="vouched">Vouched for the notes</h2>
      {rows.length === 0 && <p className="muted panel">The onboarding agent has vouched for no wallet yet.</p>}
      {rows.length > 0 && (
        <div className="table-wrap panel">
          <table>
            <thead><tr><th>Client</th><th>Route</th><th>Wallet</th><th>Identity</th><th>The notes' claim</th><th>Eligible for the notes</th><th /></tr></thead>
            <tbody>
              {rows.map((p) => {
                const d = dataOf(p.admission);
                const note = claimState(p.claims.note);
                return (
                  <tr key={p.admission.id}>
                    <td>{nameOf(p.admission)}</td>
                    <td>{ROUTE_LABEL[p.admission.route]}</td>
                    <td><Address value={p.wallet} /></td>
                    <td><Address value={p.identity} /></td>
                    <td><span className={`pill ${note.pill}`}>{note.label}</span>{d.note?.status === "declined" && <> <span className="muted">declined</span></>}</td>
                    <td>{p.eligible.note ? "Yes" : "No"}</td>
                    <td>
                      {d.note?.status === "approved" && (
                        <details>
                          <summary title="Withdraws the onboarding agent's claim: the wallet can no longer receive any of the notes.">Revoke…</summary>
                          <ActionForm action={revokeNoteAction} hidden={{ id: p.admission.id }} label="Revoke the notes' claim" working="Revoking…" quiet>
                            <p className="muted">At once: the wallet can no longer receive any of the notes. Units it holds stay its own until the Agent acts.</p>
                            <label>Reason<input name="reason" required maxLength={500} /></label>
                          </ActionForm>
                        </details>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
