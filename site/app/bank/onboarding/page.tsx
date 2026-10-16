import Link from "next/link";
import { getStore } from "@/lib/store";
import { ROUTE_LABEL, dataOf } from "@/lib/identity/onboarding";
import { claimState, participants } from "@/lib/identity/participants";
import {
  confirmRouteAction,
  creditDepositAction,
  declineRouteAction,
  offboardAction,
  renewDepositAction,
  revokeDepositAction,
} from "../../actions";
import { ActionForm } from "../../staff/ActionForm";
import { ClientReference, when } from "../../staff/parts";
import { Address } from "../../Address";

export const dynamic = "force-dynamic";

/**
 * The bank's onboarding (ADR 0089): the routes clients ask for, confirmed against the bank's
 * records; the wallets it has vouched for; and its claim on each, revoked or renewed here.
 */
export default async function BankOnboarding() {
  const store = getStore();
  const [admissions, clients] = await Promise.all([store.listAdmissions(500), store.listClients()]);
  const waiting = admissions.filter((a) => a.status === "requested" && a.route !== "existing-identity");
  const inProgress = admissions.filter((a) => ["awaiting-wallet", "awaiting-custodian"].includes(a.status) && a.route !== "existing-identity");
  const onboarded = await participants((a) => a.route !== "existing-identity");
  const nameOf = (ref?: string) => {
    const c = clients.find((x) => x.kycReference === ref);
    return c ? `${String(c.claims.legalName)} (${c.kycReference})` : ref ?? "";
  };
  return (
    <>
      <h2 id="waiting">Waiting for the bank</h2>
      {waiting.length === 0 && <p className="muted panel">No client is waiting for the bank to confirm a route.</p>}
      {waiting.map((a) => {
        const r = dataOf(a).request!;
        return (
          <section className="panel" key={a.id}>
            <p className="eyebrow">{ROUTE_LABEL[a.route]}, asked {when(a.createdAt)}</p>
            <h3 style={{ margin: "0.25rem 0 1rem" }}>{r.organisation} <span className="muted">({r.requestedBy})</span></h3>
            <p className="muted">
              {a.route === "bank-custody" && "Confirming opens a segregated account at the bank's custody platform, creates its identity, managed by the platform, and adds the bank's claim, so it can hold the deposit at once."}
              {a.route === "third-party" && "Confirming sends the client to its custodian, which opens the account from its own portal. The bank's claim is added once it does."}
              {a.route === "self-custody" && "Confirming lets the client connect its wallet and sign. The bank then creates the identity, adds its claim and hands the identity to the client's wallet."}
            </p>
            {clients.length > 0 ? (
              <ActionForm action={confirmRouteAction} hidden={{ id: a.id }} label="Confirm the client's KYB" working="Confirming; on Ethereum Sepolia a custody account takes a few minutes…">
                <div className="fields"><ClientReference clients={clients} known={r.knownReference} /></div>
              </ActionForm>
            ) : (
              <p className="notice">The bank has no client yet. <Link href="/bank/clients">Add the client under Clients</Link>, then confirm the request here.</p>
            )}
            <details>
              <summary>Decline…</summary>
              <ActionForm action={declineRouteAction} hidden={{ id: a.id }} label="Decline" working="Declining…" quiet>
                <label>Reason<input name="reason" maxLength={500} /></label>
              </ActionForm>
            </details>
          </section>
        );
      })}

      {inProgress.length > 0 && (
        <>
          <h2 id="in-progress">Confirmed, not yet onboarded</h2>
          <div className="table-wrap panel">
            <table>
              <thead><tr><th>Client</th><th>Route</th><th>Waiting for</th><th>Since</th></tr></thead>
              <tbody>
                {inProgress.map((a) => (
                  <tr key={a.id}>
                    <td>{nameOf(dataOf(a).kycReference)}</td>
                    <td>{ROUTE_LABEL[a.route]}</td>
                    <td>{a.status === "awaiting-wallet" ? "the client's wallet signature" : "the custodian to open the account"}{dataOf(a).error && <><br /><span className="notice err">{dataOf(a).error}</span></>}</td>
                    <td>{when(dataOf(a).confirmedAt ?? a.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      <h2 id="onboarded">Onboarded for the deposit</h2>
      {onboarded.length === 0 && <p className="muted panel">No wallet is onboarded yet.</p>}
      {onboarded.length > 0 && (
        <div className="table-wrap panel">
          <table>
            <thead><tr><th>Client</th><th>Route</th><th>Wallet</th><th>Identity</th><th>The bank's claim</th><th>The note's claim</th><th /></tr></thead>
            <tbody>
              {onboarded.map((p) => {
                const a = p.admission;
                const deposit = claimState(p.claims.deposit);
                const note = claimState(p.claims.note);
                return (
                  <tr key={a.id}>
                    <td>{nameOf(dataOf(a).kycReference)}{a.status === "offboarded" && <><br /><span className="pill revoked">offboarded</span></>}</td>
                    <td>{ROUTE_LABEL[a.route]}</td>
                    <td><Address value={p.wallet} /></td>
                    <td><Address value={p.identity} /></td>
                    <td><span className={`pill ${deposit.pill}`}>{deposit.label}</span></td>
                    <td><span className={`pill ${note.pill}`}>{note.label}</span></td>
                    <td>
                      {a.status === "onboarded" && (
                        <div className="stack-actions">
                          <details>
                            <summary>Credit deposit…</summary>
                            <ActionForm action={creditDepositAction} hidden={{ id: a.id }} label="Credit" working="Crediting the deposit…">
                              <label>Amount<input name="amount" required inputMode="decimal" placeholder="10.00" /></label>
                            </ActionForm>
                          </details>
                          <details>
                            <summary>Renew the bank's claim…</summary>
                            <ActionForm action={renewDepositAction} hidden={{ id: a.id }} label="Renew" working="Adding a fresh claim…">
                              <p className="muted">A fresh claim against the client's current record, running another 180 days.</p>
                            </ActionForm>
                          </details>
                          <details>
                            <summary>Revoke the bank's claim…</summary>
                            <ActionForm action={revokeDepositAction} hidden={{ id: a.id }} label="Revoke" working="Revoking…" quiet>
                              <p className="muted">At once: the wallet can no longer hold or receive the deposit. Its identity and the note's claim are untouched.</p>
                              <label>Reason<input name="reason" required maxLength={500} /></label>
                            </ActionForm>
                          </details>
                          <details>
                            <summary>Offboard…</summary>
                            <ActionForm action={offboardAction} hidden={{ id: a.id }} label="Offboard" working="Revoking and removing…" quiet>
                              <p className="muted">Revokes the bank's claim and removes the wallet from every registry: it can no longer hold, send or receive either asset.</p>
                              <label>Reason<input name="reason" required maxLength={500} /></label>
                            </ActionForm>
                          </details>
                        </div>
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
