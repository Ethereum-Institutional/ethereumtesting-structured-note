import { getStore } from "@/lib/store";
import { CORPORATE_STATUSES, LEGAL_FORMS } from "@/lib/identity/clients";
import { CLAIM_DAYS } from "@/lib/identity/onchain";
import { addClientAction, removeClientAction, rescreenClientAction } from "../../actions";
import { ActionForm } from "../../staff/ActionForm";
import { PendingButton } from "../../PendingButton";
import { AddClientForm } from "../../staff/AddClientForm";
import { ageDays, day } from "../../staff/parts";

export const dynamic = "force-dynamic";

/** The bank's KYB records (ADR 0089): the facts, kept here, and the hash its claims carry. */
export default async function Clients() {
  const clients = await getStore().listClients();
  return (
    <>
      <h2 id="clients">Clients</h2>
      <section className="panel">
        <p className="muted">
          The bank's corporate clients. Their facts are entered once and stay here, in the bank's records. What reaches the
          chain is the bank's claim on a client's identity, carrying only a salted hash of this record, which anyone the bank
          shows the record to can check. A claim runs {CLAIM_DAYS} days; re-screening verifies the facts again and the bank
          renews its claims from the Onboarding page.
        </p>
        {clients.length > 0 && (
          <div className="table-wrap">
            <table style={{ whiteSpace: "nowrap" }}>
              <thead>
                <tr><th>Client</th><th>Reference</th><th>Form</th><th>Jurisdiction</th><th>Status</th><th>Class</th><th>Verified</th><th>Record hash</th><th /></tr>
              </thead>
              <tbody>
                {clients.map((c) => {
                  const age = ageDays(c.issuedAt);
                  return (
                    <tr key={c.id}>
                      <td>{String(c.claims.legalName)}</td>
                      <td>{c.kycReference}</td>
                      <td>{String(c.claims.legalForm)}</td>
                      <td>{String(c.claims.jurisdiction)}</td>
                      <td>{String(c.claims.status)}</td>
                      <td>{String(c.claims.investorClass ?? "institutional by policy")}</td>
                      <td>{day(c.issuedAt)} <span className="muted">({age} d)</span></td>
                      <td><code title={c.recordHash}>{c.recordHash.slice(0, 10)}…</code></td>
                      <td>
                        <form action={rescreenClientAction}>
                          <input type="hidden" name="id" value={c.id} />
                          <PendingButton className="quiet" working="Re-screening…">Re-screen</PendingButton>
                        </form>
                        <details>
                          <summary>Remove…</summary>
                          <ActionForm action={removeClientAction} hidden={{ id: c.id }} label="Remove the client" working="Removing…" quiet>
                            <p className="muted" style={{ margin: 0 }}>
                              Removes the record, so the client can be added again with its facts put right. Refused while an account for it is onboarded on the
                              chain: offboard it first. Onboardings in progress go back to Onboarding, to be confirmed again.
                            </p>
                            <label>Reason<input name="reason" required maxLength={500} /></label>
                          </ActionForm>
                        </details>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <div id="add-client">
          <h3>Add a corporate client</h3>
          <AddClientForm action={addClientAction} legalForms={LEGAL_FORMS} statuses={CORPORATE_STATUSES} />
        </div>
      </section>
    </>
  );
}
