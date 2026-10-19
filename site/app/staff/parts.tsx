import type { Client, Registrant } from "@/lib/store";
import { decideAction, resendLinkAction } from "../actions";
import { ResendLink } from "./ResendLink";

/** What the staff portals share: the client picker, sign-up decisions, links and times. */

export const day = (iso: string) => iso.slice(0, 10);
export const ageDays = (iso: string) => Math.floor((Date.now() - Date.parse(iso)) / 86_400_000);

/** The client an onboarding is for: chosen from the bank's records. */
export function ClientReference({ clients, known }: { clients: Client[]; known?: string }) {
  if (!clients.length) {
    return <p className="muted">The bank has no client yet: add one under Clients.</p>;
  }
  return (
    <label>
      Client
      <select name="kycReference" required defaultValue={clients.some((c) => c.kycReference === known) ? known : ""}>
        <option value="" disabled>Choose the client…</option>
        {clients.map((c) => (
          <option key={c.id} value={c.kycReference}>
            {String(c.claims.legalName)} ({c.kycReference}), {String(c.claims.jurisdiction)}, verified {day(c.issuedAt)}
          </option>
        ))}
      </select>
    </label>
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
    : r.status === "unverified" ? <><ResendLink id={r.id} email={r.email} action={resendLinkAction} />{act("approve", "Approve")}{act("revoke", "Decline")}</>
    : r.status === "approved" && !self ? act("revoke", "Revoke")
    : r.status === "revoked" ? act("approve", "Reinstate")
    : null;
  if (!buttons) return null;
  return <div className="actions">{buttons}</div>;
}
