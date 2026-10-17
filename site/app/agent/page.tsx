import { ROUTE_LABEL } from "@/lib/identity/onboarding";
import { claimState, participants } from "@/lib/identity/participants";
import { vouchers } from "@/lib/identity/onchain";
import { Address } from "../Address";
import { holdingsFromIndex } from "@/lib/chain/events";
import { notesOnRecord } from "@/lib/notes/registry";

export const dynamic = "force-dynamic";

/**
 * The participants as the Agent sees them (ADR 0089): as Issuing and Paying Agent and registrar it
 * sees wallets, identities and which institutions vouched for each, never a client's facts.
 */
export default async function Participants() {
  const [rows, held, notes] = await Promise.all([participants(), holdingsFromIndex().catch(() => new Map<string, Map<string, bigint>>()), notesOnRecord().catch(() => [])]);
  const symbolOf = new Map(notes.map((n) => [n.token.toLowerCase(), n.symbol]));
  // What each wallet holds of every note in the book.
  const holdingsOf = (wallet: string) =>
    [...held.entries()].map(([token, accounts]) => ({ symbol: symbolOf.get(token) ?? token, units: accounts.get(wallet.toLowerCase()) ?? 0n })).filter((h) => h.units > 0n);
  let issuers: { deposit: string; note: string } | null = null;
  try {
    const v = vouchers();
    issuers = { deposit: v.deposit.issuer, note: v.note.issuer };
  } catch {
    issuers = null;
  }
  return (
    <>
      <h2 id="participants">Participants</h2>
      <p className="muted panel">
        Every onboarded wallet, its identity, and the claims on it, as the chain holds them now. The facts behind each claim
        stay with the institution that verified them: the bank for the deposit
        {issuers && <> (claim issuer <Address value={issuers.deposit} />)</>}, the onboarding agent for the notes
        {issuers && <> (<Address value={issuers.note} />)</>}.
      </p>
      {rows.length > 0 && (
        <div className="table-wrap panel">
          <table>
            <thead><tr><th>Wallet</th><th>Identity</th><th>Route</th><th>The bank vouches</th><th>The onboarding agent vouches</th><th>May hold the deposit</th><th>May hold the notes</th><th>Holds</th></tr></thead>
            <tbody>
              {rows.map((p) => {
                const dep = claimState(p.claims.deposit);
                const note = claimState(p.claims.note);
                return (
                  <tr key={p.admission.id}>
                    <td><Address value={p.wallet} /></td>
                    <td><Address value={p.identity} /></td>
                    <td>{ROUTE_LABEL[p.admission.route]}</td>
                    <td><span className={`pill ${dep.pill}`}>{dep.label}</span></td>
                    <td><span className={`pill ${note.pill}`}>{note.label}</span></td>
                    <td>{p.eligible.deposit ? "Yes" : "No"}</td>
                    <td>{p.eligible.note ? "Yes" : "No"}</td>
                    <td style={{ whiteSpace: "normal" }}>{holdingsOf(p.wallet).map((h) => `${h.units} ${h.symbol}`).join(", ") || "—"}</td>
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
