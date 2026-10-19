import { getStore } from "@/lib/store";
import { custodianOf, dataOf } from "@/lib/identity/onboarding";
import { custodian, custodianAddress } from "@/lib/identity/custody";
import { claimState, participants } from "@/lib/identity/participants";
import { custodyConvertAction, openAccountAction } from "../actions";
import { ActionForm } from "../staff/ActionForm";
import { when } from "../staff/parts";
import { Address } from "../Address";
import { accountNamer } from "@/lib/identity/names";

export const dynamic = "force-dynamic";

/**
 * The custodians. Each opens segregated accounts for its clients, signs for them, and
 * manages their identities, since key custody follows custody. The bank's custody platform opens
 * an account as soon as the bank confirms; a third-party custodian opens it here. The bank's
 * custody platform converts in the pool for an account the bank admitted.
 */
export default async function Accounts() {
  const nameOf = await accountNamer();
  const admissions = await getStore().listAdmissions(500);
  const waiting = admissions.filter((a) => a.status === "awaiting-custodian" && a.route === "third-party");
  const held = await participants((a) => custodianOf(a) !== null);
  const names = (() => {
    try {
      return { bank: { label: custodian("bank").label, address: custodianAddress("bank") as string | null }, "third-party": { label: custodian("third-party").label, address: custodianAddress("third-party") as string | null } };
    } catch {
      return { bank: { label: "the bank's custody platform", address: null }, "third-party": { label: "the third-party custodian", address: null } };
    }
  })();
  return (
    <>
      <h2 id="waiting">Waiting for the third-party custodian</h2>
      {waiting.length === 0 && <p className="muted panel">No client confirmed by the bank is waiting for an account.</p>}
      {waiting.map((a) => {
        const d = dataOf(a);
        return (
          <section className="panel" key={a.id}>
            <p className="eyebrow">Confirmed by the bank {when(d.confirmedAt ?? a.createdAt)}</p>
            <h3 style={{ margin: "0.25rem 0 1rem" }}>{d.request?.organisation} <span className="muted">({d.kycReference})</span></h3>
            <ActionForm action={openAccountAction} hidden={{ id: a.id }} label="Open the account" working="Opening the account, creating its identity and recording consent: up to a minute…">
              <p className="muted">
                Opens a segregated account for the client. Its identity is created managed by the custodian, which records the
                client's consent to the bank and the onboarding agent vouching for it; the bank then adds its claim.
              </p>
            </ActionForm>
          </section>
        );
      })}

      {(["bank", "third-party"] as const).map((which) => {
        const rows = held.filter((p) => custodianOf(p.admission) === which);
        return (
          <section key={which}>
            <h2 id={which}>Held by {names[which].label}</h2>
            {names[which].address && <p className="muted">Its operator key: <Address value={names[which].address} /></p>}
            {rows.length === 0 && <p className="muted panel">No account yet.</p>}
            {rows.length > 0 && (
              <div className="table-wrap panel">
                <table>
                  <thead><tr><th>Client</th><th>Reference</th><th>Account</th><th>Identity</th><th>Deposit</th><th>Note</th><th>Pool</th><th /></tr></thead>
                  <tbody>
                    {rows.map((p) => {
                      const d = dataOf(p.admission);
                      const dep = claimState(p.claims.deposit);
                      const note = claimState(p.claims.note);
                      return (
                        <tr key={p.admission.id}>
                          <td>{nameOf(p.admission)}</td>
                          <td>{d.clientRef}</td>
                          <td><Address value={p.wallet} /></td>
                          <td><Address value={p.identity} /></td>
                          <td><span className={`pill ${dep.pill}`}>{dep.label}</span></td>
                          <td><span className={`pill ${note.pill}`}>{note.label}</span></td>
                          <td className="pool-standing">{p.pool ?? "no pool"}</td>
                          <td>
                            {which === "bank" && p.pool === "admitted" && (
                              <details>
                                <summary title="Converts for the client in the pool, between the euro payment token and the bank's deposit, from its custody account.">Convert…</summary>
                                <ActionForm action={custodyConvertAction} hidden={{ id: p.admission.id }} label="Convert for the client" working="Converting in the pool…" quiet>
                                  <label>
                                    Direction
                                    <select name="direction" defaultValue="into-deposit">
                                      <option value="into-deposit">Payment token into the deposit</option>
                                      <option value="into-payment">Deposit into the payment token</option>
                                    </select>
                                  </label>
                                  <label>Amount paid<input name="amount" required inputMode="decimal" placeholder="1000.00" /></label>
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
          </section>
        );
      })}
    </>
  );
}
