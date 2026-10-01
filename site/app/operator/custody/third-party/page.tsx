import { getStore } from "@/lib/store";
import { reviewSelfCustodyAction } from "../../../actions";
import { PendingButton } from "../../../PendingButton";
import { ClientReference, when } from "../../parts";

export const dynamic = "force-dynamic";

export default async function SelfCustody() {
  const store = getStore();
  const [admissions, clients] = await Promise.all([store.listAdmissions(200), store.listClients()]);
  const queue = admissions.filter((a) => a.route === "self-custody" && a.status === "awaiting-bank-review");
  return (
    <>
      <h2 id="third-party">Third-party requests</h2>
      {queue.length === 0 && <p className="muted panel">No client is waiting for its KYB to be confirmed.</p>}
      {queue.map((a) => {
        const r = (a.data as Record<string, any>).request;
        return (
          <section className="panel" key={a.id}>
            <p className="eyebrow">Requested {when(a.createdAt)}</p>
            <h3 style={{ margin: "0.25rem 0 1rem" }}>{r.organisation} <span className="muted">({r.requestedBy})</span></h3>
            <form action={reviewSelfCustodyAction} className="stack">
              <input type="hidden" name="id" value={a.id} />
              <input type="hidden" name="decision" value="approve" />
              <div className="fields">
                <ClientReference clients={clients} known={r.knownReference ?? r.kycReference} />
              </div>
              <div className="actions">
                <PendingButton working="Finding the client's corporate identity at the bank…">Confirm the client's KYB</PendingButton>
                <button type="submit" form={`decline-${a.id}`} className="quiet">Decline</button>
              </div>
            </form>
            <form action={reviewSelfCustodyAction} id={`decline-${a.id}`} hidden>
              <input type="hidden" name="id" value={a.id} />
              <input type="hidden" name="decision" value="decline" />
            </form>
          </section>
        );
      })}
    </>
  );
}
