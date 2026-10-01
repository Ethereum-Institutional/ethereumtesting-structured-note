import type { Client, Registrant } from "@/lib/store";
import {
  creditDepositAction,
  custodyConvertAction,
  decideAction,
  offboardAction,
  revokeAtBankAction,
} from "../actions";
import { PendingButton } from "../PendingButton";

/** What the Operator pages share (ADR 0073): the client picker, an admitted account's actions, links and times. */

export const day = (iso: string) => iso.slice(0, 10);
export const ageDays = (iso: string) => Math.floor((Date.now() - Date.parse(iso)) / 86_400_000);

/** The client an admission is for: chosen from the clients added on this site (ADR 0066). */
export function ClientReference({ clients, known }: { clients: Client[]; known?: string }) {
  if (!clients.length) {
    return <p className="muted">No client has been added yet: add one under Clients.</p>;
  }
  return (
    <label>
      Client
      <select name="kycReference" required defaultValue={clients.some((c) => c.kycReference === known) ? known : ""}>
        <option value="" disabled>Choose the client…</option>
        {clients.map((c) => (
          <option key={c.id} value={c.kycReference}>
            {String(c.claims.legalName)} ({c.kycReference}), {String(c.claims.jurisdiction)}, screened {day(c.issuedAt)}
          </option>
        ))}
      </select>
    </label>
  );
}

/** Offboarding and revocation for an admitted account (ADRs 0063, 0064): each folded away until wanted. */
export function AdmittedActions({ id, affected, custodied, symbols, notes }: { id: string; affected: number; custodied: boolean; symbols: { payment: string; deposit: string }; notes: string[] }) {
  return (
    <div className="stack-actions">
      <details>
        <summary>Credit deposit…</summary>
        <form action={creditDepositAction} className="stack">
          <input type="hidden" name="id" value={id} />
          <p className="muted">The Deposit Agent credits {symbols.deposit} to this account through the deposit gateway, against a booking reference the site assigns.</p>
          <label>Amount of {symbols.deposit}<input name="amount" required inputMode="decimal" placeholder="10.00" /></label>
          <PendingButton working="Crediting the deposit…">Credit</PendingButton>
        </form>
      </details>
      {custodied && (
        <details>
          <summary>Convert…</summary>
          <form action={custodyConvertAction} className="stack">
            <input type="hidden" name="id" value={id} />
            <p className="muted">On the client's instruction: the custodian converts in the pool for this account, refused if the pool gives more than 0.5% less than its quote.</p>
            <label>
              Convert
              <select name="direction" defaultValue="into-deposit">
                <option value="into-deposit">{symbols.payment} into {symbols.deposit}</option>
                <option value="into-payment">{symbols.deposit} into {symbols.payment}</option>
              </select>
            </label>
            <label>Amount<input name="amount" required inputMode="decimal" placeholder="10.00" /></label>
            <PendingButton working="Converting in the pool…">Convert</PendingButton>
          </form>
        </details>
      )}
      {notes.map((n) => <span key={n} className="muted">{n}</span>)}
      <details>
        <summary>Offboard…</summary>
        <form action={offboardAction} className="stack">
          <input type="hidden" name="id" value={id} />
          <p className="muted">Revokes its pool grant and its Identity Registry grant. It can no longer convert, or hold or move the deposit; the bank redeems any balance. Its credentials at the bank are untouched.</p>
          <label>Reason<input name="reason" required maxLength={500} /></label>
          <PendingButton working="Revoking both grants…">Offboard</PendingButton>
        </form>
      </details>
      <details>
        <summary>Revoke at the bank…</summary>
        <form action={revokeAtBankAction} className="stack">
          <input type="hidden" name="id" value={id} />
          <input type="hidden" name="which" value="wallet" />
          <p className="muted">Revokes this wallet's wallet-control credential at the bank. Only this wallet is affected.</p>
          <label>Reason<input name="reason" required maxLength={500} /></label>
          <PendingButton className="quiet" working="Revoking at the bank…">Revoke the wallet credential</PendingButton>
        </form>
        <form action={revokeAtBankAction} className="stack" style={{ marginTop: "1rem" }}>
          <input type="hidden" name="id" value={id} />
          <input type="hidden" name="which" value="corporate" />
          <input type="hidden" name="affected" value={affected} />
          <p className="muted">Revokes the client's corporate identity: its KYB. Every wallet onboarded on it falls.</p>
          <label>Reason<input name="reason" required maxLength={500} /></label>
          <label style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
            <input type="checkbox" required /> I understand this withdraws the KYB for {affected} admitted wallet{affected === 1 ? "" : "s"}.
          </label>
          <PendingButton className="quiet" working="Revoking at the bank…">Revoke the corporate identity</PendingButton>
        </form>
      </details>
    </div>
  );
}

/** A value that opens in the chain's explorer where there is one. */
export function Linked({ href, children }: { href: string | null; children: React.ReactNode }) {
  return href ? <a href={href} target="_blank" rel="noreferrer">{children}</a> : <>{children}</>;
}

export const when = (iso: string | null) => (iso ? iso.slice(0, 16).replace("T", " ") + " UTC" : "");

export function Decide({ r, self }: { r: Registrant; self: boolean }) {
  // One form per decision, carried in a hidden field: the clicked button's own name and value are not sent.
  const act = (decision: "approve" | "revoke", label: string) => (
    <form action={decideAction}>
      <input type="hidden" name="id" value={r.id} />
      <input type="hidden" name="decision" value={decision} />
      <button type="submit" className="quiet">{label}</button>
    </form>
  );
  const buttons =
    r.status === "pending" ? <>{act("approve", "Approve")}{act("revoke", "Decline")}</>
    : r.status === "approved" && !self ? act("revoke", "Revoke")
    : r.status === "revoked" ? act("approve", "Reinstate")
    : null;
  if (!buttons) return null;
  return <div className="actions">{buttons}</div>;
}
