import { getStore } from "@/lib/store";
import { admitCustodiedAction } from "../../../actions";
import { PendingButton } from "../../../PendingButton";
import { ClientReference, day } from "../../parts";

export const dynamic = "force-dynamic";

export default async function Custodial() {
  const clients = await getStore().listClients();
  const requests = clients.filter((c) => c.custodyRequest);
  return (
    <>
      {requests.length > 0 && (
        <>
          <h2 id="custody-requests">Asked for by clients</h2>
          <div className="table-wrap panel">
            <table>
              <thead><tr><th>Client</th><th>Asked by</th><th>On</th><th /></tr></thead>
              <tbody>
                {requests.map((c) => (
                  <tr key={c.id}>
                    <td>{String(c.claims.legalName)} ({c.kycReference})</td>
                    <td>{c.custodyRequest!.email}</td>
                    <td>{day(c.custodyRequest!.at)}</td>
                    <td>
                      <form action={admitCustodiedAction} className="actions">
                        <input type="hidden" name="kycReference" value={c.kycReference} />
                        <PendingButton working="Opening the custody account and writing its grants: up to a minute.">Admit</PendingButton>
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="muted">Once the custody account is admitted, the client's own wallet is unbound: one wallet per KYB.</p>
        </>
      )}
      <h2 id="custodied">Admit a custodied client</h2>
      <section className="panel">
        <p className="muted">
          On the client's instruction: opens a segregated custody account, mints its wallet credential under the client's
          corporate identity, writes both grants once the bank has anchored it, and makes the account ready to trade.
          The client's facts come from Clients; the site assigns the custody account's reference. One wallet
          per client: once the new account is admitted, the client's current wallet, by any route, is offboarded.
        </p>
        <form action={admitCustodiedAction} className="stack">
          <div className="fields">
            <ClientReference clients={clients} />
          </div>
          <div className="actions">
            <PendingButton working="Opening the custody account, binding its wallet with the bank, writing both grants and setting its trading approvals. This takes up to a minute; keep this page open.">
              Admit
            </PendingButton>
          </div>
        </form>
      </section>
    </>
  );
}
