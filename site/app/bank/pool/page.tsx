import { POOL_CLASSES, ROUTE_LABEL, dataOf } from "@/lib/identity/onboarding";
import { claimState, participants } from "@/lib/identity/participants";
import { loadManifest } from "@/lib/chain/manifest";
import { admitToPoolAction, revokePoolAction } from "../../actions";
import { ActionForm } from "../../staff/ActionForm";
import { Address } from "../../Address";
import { accountNamer } from "@/lib/identity/names";

export const dynamic = "force-dynamic";

/**
 * Admission to the conversion pool: the bank vouches with the pool-access claim on its
 * client's identity, and revokes it here. The pool's gate reads the claim through the
 * pool's own identity registry, with the client's country and any supervisory withdrawal.
 */
export default async function Pool() {
  const nameOf = await accountNamer();
  if (!loadManifest().venue) {
    return (
      <>
        <h2 id="pool">Conversion pool</h2>
        <p className="muted panel">This deployment has no conversion pool: it was deployed with POOL=0.</p>
      </>
    );
  }
  const rows = (await participants((a) => a.status === "onboarded")).filter((p) => p.eligible.deposit || p.claims.pool.present);
  return (
    <>
      <h2 id="pool">Conversion pool</h2>
      <p className="muted">
        A wallet converts between the payment token and the deposit when the bank's pool-access claim stands on its identity, its country is
        one the pool serves, and supervision has not withdrawn it. The claim runs 90 days.
      </p>
      {rows.length === 0 && <p className="muted panel">No wallet the deposit accepts yet.</p>}
      {rows.length > 0 && (
        <div className="table-wrap panel">
          <table>
            <thead><tr><th>Client</th><th>Route</th><th>Wallet</th><th>Pool-access claim</th><th>The pool says</th><th /></tr></thead>
            <tbody>
              {rows.map((p) => {
                const d = dataOf(p.admission);
                const claim = claimState(p.claims.pool);
                return (
                  <tr key={p.admission.id} data-wallet={p.wallet}>
                    <td>{nameOf(p.admission)}</td>
                    <td>{ROUTE_LABEL[p.admission.route]}</td>
                    <td><Address value={p.wallet} /></td>
                    <td><span className={`pill ${claim.pill}`}>{claim.label}</span>{d.pool && <> <span className="muted">{d.pool.investorClass}</span></>}</td>
                    <td className="pool-standing">{p.pool}</td>
                    <td>
                      {p.claims.pool.valid ? (
                        <details>
                          <summary title="Withdraws the bank's pool-access claim: the wallet can no longer convert in the pool.">Revoke…</summary>
                          <ActionForm action={revokePoolAction} hidden={{ id: p.admission.id }} label="Revoke pool access" working="Revoking…" quiet>
                            <p className="muted">At once: the wallet can no longer convert. What it holds stays its own.</p>
                            <label>Reason<input name="reason" required maxLength={500} /></label>
                          </ActionForm>
                        </details>
                      ) : (
                        <details>
                          <summary title="Adds the bank's pool-access claim: the wallet may then convert the euro payment token and the deposit in the pool.">Admit…</summary>
                          <ActionForm action={admitToPoolAction} hidden={{ id: p.admission.id }} label="Admit to the pool" working="Signing and adding the claim…" quiet>
                            <p className="muted">The bank has found the client one of the pool's investor classes, and screened it.</p>
                            <label>
                              Investor class
                              <select name="investorClass" defaultValue="institutional">
                                {POOL_CLASSES.map((c) => <option key={c} value={c}>{c}</option>)}
                              </select>
                            </label>
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
