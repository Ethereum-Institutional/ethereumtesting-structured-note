import { getStore } from "@/lib/store";
import { admitCustodiedAction } from "../../../actions";
import { PendingButton } from "../../../PendingButton";
import { ClientReference } from "../../parts";

export const dynamic = "force-dynamic";

export default async function Custodial() {
  const clients = await getStore().listClients();
  return (
    <>
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
