import { notFound } from "next/navigation";
import { currentOperator } from "@/lib/access";
import { getStore, type Registrant } from "@/lib/store";
import { explorerAddress, explorerTx } from "@/lib/explorer";
import { admitCustodiedAction, decideAction, decideAdmissionAction, reviewSelfCustodyAction } from "../actions";
import { Bar } from "../Bar";

export const dynamic = "force-dynamic";

/** What the bank states from its own file about the client (ADR 0054). */
function BankRecordFields() {
  return (
    <>
      <label>Legal name<input name="legalName" required maxLength={200} /></label>
      <label>Jurisdiction (ISO code)<input name="jurisdiction" required pattern="[A-Za-z]{2}" maxLength={2} /></label>
      <label>
        Status
        <select name="status" defaultValue="active"><option value="active">Active</option><option value="suspended">Suspended</option></select>
      </label>
      <label>Last sanctions screening<input name="screenedOn" type="date" /></label>
      <label>
        Investor class
        <select name="investorClass" defaultValue=""><option value="">Institutional (by policy)</option><option value="professional">Professional</option></select>
      </label>
    </>
  );
}

/** A value that opens in the chain's explorer where there is one. */
function Linked({ href, children }: { href: string | null; children: React.ReactNode }) {
  return href ? <a href={href} target="_blank" rel="noreferrer">{children}</a> : <>{children}</>;
}

const when = (iso: string | null) => (iso ? iso.slice(0, 16).replace("T", " ") + " UTC" : "");

function Decide({ r, self }: { r: Registrant; self: boolean }) {
  const act = (decision: "approve" | "revoke", label: string) => (
    <form action={decideAction}>
      <input type="hidden" name="id" value={r.id} />
      <input type="hidden" name="decision" value={decision} />
      <button type="submit" className="quiet">{label}</button>
    </form>
  );
  if (r.status === "pending") return <>{act("approve", "Approve")} {act("revoke", "Decline")}</>;
  if (r.status === "approved" && !self) return act("revoke", "Revoke");
  if (r.status === "revoked") return act("approve", "Reinstate");
  return null;
}

export default async function Operator() {
  const op = await currentOperator();
  if (!op) notFound();
  const store = getStore();
  const [rows, log, admissions] = await Promise.all([store.listRegistrants(), store.auditLog(50), store.listAdmissions(30)]);
  const order = { pending: 0, approved: 1, unverified: 2, revoked: 3 } as const;
  rows.sort((a, b) => order[a.status] - order[b.status]);
  return (
    <div className="wrap">
      <Bar who={op} operator />
      <header className="masthead" style={{ paddingBottom: "1rem" }}>
        <p className="eyebrow">Operator</p>
        <h1 style={{ fontSize: "2.5rem" }}>Access requests</h1>
      </header>
      <div className="table-wrap panel">
        <table>
          <thead>
            <tr><th>Status</th><th>Name</th><th>Organisation</th><th>Email</th><th>Registered</th><th>Decided</th><th /></tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td><span className={`pill ${r.status}`}>{r.status}</span></td>
                <td>{r.name}</td>
                <td>{r.organisation}</td>
                <td>{r.email}</td>
                <td>{when(r.createdAt)}</td>
                <td>{r.decidedBy ? `${when(r.decidedAt)}, ${r.decidedBy}` : ""}</td>
                <td><Decide r={r} self={r.email === op.email} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <h2 id="custodied">Admit a custodied client</h2>
      <section className="panel">
        <p className="muted">
          On the client's instruction: opens a segregated custody account, mints its wallet credential under the client's
          existing corporate identity, writes both grants, and makes the account ready to trade.
        </p>
        <form action={admitCustodiedAction} className="cols">
          <div>
            <label>Client reference (KYB file)<input name="kycReference" required maxLength={200} /></label>
            <label>Custody account reference<input name="clientRef" required maxLength={64} /></label>
            <label>Client instruction reference<input name="instructionRef" required maxLength={200} /></label>
          </div>
          <div>
            <BankRecordFields />
            <button type="submit">Admit</button>
          </div>
        </form>
      </section>

      <h2 id="self-custody">Self-custody requests</h2>
      <div className="table-wrap panel">
        <table>
          <thead><tr><th>Requested</th><th>Requested by</th><th>Client reference</th><th>Wallet</th><th>Review</th></tr></thead>
          <tbody>
            {admissions.filter((a) => a.route === "self-custody" && a.status === "awaiting-bank-review").map((a) => {
              const r = (a.data as Record<string, any>).request;
              return (
                <tr key={a.id}>
                  <td>{when(a.createdAt)}</td>
                  <td>{r.requestedBy}, {r.organisation}</td>
                  <td>{r.kycReference}</td>
                  <td>{r.walletAddress} ({r.addressType})</td>
                  <td>
                    <form action={reviewSelfCustodyAction}>
                      <input type="hidden" name="id" value={a.id} />
                      <input type="hidden" name="decision" value="approve" />
                      <BankRecordFields />
                      <button type="submit" className="quiet">Confirm the client and ask for the signature</button>
                    </form>
                    <form action={reviewSelfCustodyAction}>
                      <input type="hidden" name="id" value={a.id} />
                      <input type="hidden" name="decision" value="decline" />
                      <button type="submit" className="quiet">Decline</button>
                    </form>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <h2 id="admissions">Pool admissions</h2>
      <div className="table-wrap panel">
        <table style={{ whiteSpace: "nowrap" }}>
          <thead>
            <tr>
              <th>Started</th><th>Route</th><th>Status</th><th>Corporation</th><th>Officer</th><th>Wallet</th>
              <th>Wallet type</th><th>Jurisdiction</th><th>Class</th><th>Pool grant to</th><th>Pool grant</th>
              <th>Registry grant</th><th>Trading approvals</th><th>Problem</th><th />
            </tr>
          </thead>
          <tbody>
            {admissions.map((a) => {
              const d = a.data as Record<string, any>;
              const s = d.assessment?.ok ? d.assessment.summary : null;
              const w = d.written as { chainId?: number; poolGrantTx?: string; registryGrantTx?: string; readyTx?: string; poolGrantExpiresAt?: number } | undefined;
              const problem = d.assessment && !d.assessment.ok ? d.assessment.problems.join(" ") : w ? "" : d.error ?? "";
              const tx = (hash: string | undefined) =>
                hash ? <Linked href={explorerTx(w?.chainId, hash)}>{`${hash.slice(0, 10)}…`}</Linked> : "";
              return (
                <tr key={a.id}>
                  <td>{when(a.createdAt)}</td>
                  <td>{a.route}</td>
                  <td><span className={`pill ${a.status === "ready" ? "pending" : a.status === "admitted" ? "approved" : ""}`}>{a.status}</span></td>
                  <td>{s?.corporation ?? d.record?.legalName ?? ""}</td>
                  <td>{s?.officerDid ? `${s.role}, ${s.officerDid}` : ""}</td>
                  <td>{s ? <Linked href={explorerAddress(w?.chainId, s.wallet)}>{s.wallet}</Linked> : d.request?.walletAddress ?? ""}</td>
                  <td>{s?.walletType ?? d.request?.addressType ?? ""}</td>
                  <td>{s?.jurisdiction ?? d.record?.jurisdiction ?? ""}</td>
                  <td>{s?.investorClass ?? ""}</td>
                  <td>{w?.poolGrantExpiresAt ? when(new Date(w.poolGrantExpiresAt * 1000).toISOString()) : ""}</td>
                  <td>{tx(w?.poolGrantTx)}</td>
                  <td>{tx(w?.registryGrantTx)}</td>
                  <td>{tx(w?.readyTx)}</td>
                  <td style={{ whiteSpace: "normal", minWidth: 280 }}>{problem}</td>
                  <td>
                    {a.status === "ready" && (
                      <>
                        <form action={decideAdmissionAction}>
                          <input type="hidden" name="id" value={a.id} />
                          <input type="hidden" name="decision" value="approve" />
                          <button type="submit" className="quiet">Approve and write grants</button>
                        </form>{" "}
                        <form action={decideAdmissionAction}>
                          <input type="hidden" name="id" value={a.id} />
                          <input type="hidden" name="decision" value="decline" />
                          <button type="submit" className="quiet">Decline</button>
                        </form>
                      </>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <h2>Audit log</h2>
      <div className="table-wrap panel">
        <table>
          <thead><tr><th>At</th><th>Actor</th><th>Action</th><th>Subject</th></tr></thead>
          <tbody>
            {log.map((e, i) => (
              <tr key={i}><td>{when(e.at)}</td><td>{e.actor}</td><td>{e.action}</td><td>{e.subject}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
