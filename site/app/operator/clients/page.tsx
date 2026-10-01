import { getStore } from "@/lib/store";
import { bankConfig, issuedCredentials, type IssuedCredential } from "@/lib/admission/bank";
import { clientsIssuedElsewhere, CORPORATE_STATUSES, LEGAL_FORMS } from "@/lib/admission/clients";
import { NUMERIC, SCREENING_MAX_AGE } from "@/lib/admission/assess";
import { addClientAction, rescreenClientAction } from "../../actions";
import { PendingButton } from "../../PendingButton";
import { AddClientForm } from "../AddClientForm";
import { ageDays, day } from "../parts";

export const dynamic = "force-dynamic";

export default async function Clients({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const params = await searchParams;
  const clients = await getStore().listClients();
  // The bank's view of each credential (anchored or not), and the clients it holds that this site did not add.
  const [bankView, elsewhere] = await Promise.all([
    issuedCredentials(bankConfig()).then((l) => ({ list: l })).catch((e: Error) => ({ error: e.message, list: [] as IssuedCredential[] })),
    clientsIssuedElsewhere().catch(() => [] as IssuedCredential[]),
  ]);
  const stateOf = new Map(bankView.list.map((c) => [c.credentialId.toLowerCase(), c]));
  const prefill = params.prefill ? elsewhere.find((c) => c.kycReference === params.prefill) : undefined;
  return (
    <>
      <h2 id="clients">Clients</h2>
      <section className="panel">
        <p className="muted">
          The bank's corporate clients. Their facts are entered once, here; the bank's issuer server signs and anchors
          them as the client's corporate identity, and every route reads them from here.
        </p>
        {"error" in bankView && <p className="notice err">The bank could not be reached: {bankView.error}</p>}
        {clients.length > 0 && (
          <div className="table-wrap">
            <table style={{ whiteSpace: "nowrap" }}>
              <thead>
                <tr><th>Client</th><th>Reference</th><th>Form</th><th>Jurisdiction</th><th>Status</th><th>Class</th><th>DID</th><th>Screened</th><th>Corporate identity</th><th>Pickup</th><th /></tr>
              </thead>
              <tbody>
                {clients.map((c) => {
                  const bank = stateOf.get(c.credentialId.toLowerCase());
                  const age = ageDays(c.issuedAt);
                  const stale = age * 86_400 > SCREENING_MAX_AGE;
                  return (
                    <tr key={c.id}>
                      <td>{String(c.claims.legalName)}</td>
                      <td>{c.kycReference}</td>
                      <td>{String(c.claims.legalForm)}</td>
                      <td>{String(c.claims.jurisdiction)}</td>
                      <td>{String(c.claims.status)}</td>
                      <td>{String(c.claims.investorClass ?? "institutional by policy")}</td>
                      <td>{c.subjectDid}</td>
                      <td>
                        {day(c.issuedAt)} {stale ? <span className="pill revoked">over 30 days: re-screen</span> : <span className="muted">({age} d)</span>}
                      </td>
                      <td>
                        {c.credentialId.slice(0, 10)}… <span className={`pill ${bank?.revokedAt ? "revoked" : bank?.rootAnchorTxHash ? "approved" : "pending"}`}>{bank?.revokedAt ? "revoked" : bank?.rootAnchorTxHash ? "anchored" : bank ? "pending anchor" : "not at the bank"}</span>
                      </td>
                      <td><input readOnly value={c.pickupUrl} aria-label={`Pickup URL for ${c.kycReference}`} style={{ width: "14rem", fontSize: "0.75rem" }} /></td>
                      <td>
                        <form action={rescreenClientAction}>
                          <input type="hidden" name="id" value={c.id} />
                          <PendingButton className="quiet" working="Issuing again…">Re-screen</PendingButton>
                        </form>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {elsewhere.length > 0 && (
          <>
            <h3>Issued outside this site</h3>
            <p className="muted">The bank holds these corporate identities, but this site does not know their facts. Re-issue a client here before onboarding it.</p>
            <ul>
              {elsewhere.map((c) => (
                <li key={c.credentialId}>
                  {c.kycReference}, issued {new Date(c.issuedAt * 1000).toISOString().slice(0, 10)}, to {c.subjectDid}{" "}
                  <a href={`/operator/clients?prefill=${encodeURIComponent(c.kycReference ?? "")}#add-client`}>Re-issue here</a>
                </li>
              ))}
            </ul>
          </>
        )}
        <div id="add-client">
          <h3>Add a corporate client</h3>
          <div>
            <AddClientForm
              action={addClientAction}
              allowed={Object.keys(NUMERIC)}
              legalForms={LEGAL_FORMS}
              statuses={CORPORATE_STATUSES}
              prefill={prefill ? { kycReference: prefill.kycReference, subjectDid: prefill.subjectDid } : undefined}
            />
          </div>
        </div>
      </section>
    </>
  );
}
