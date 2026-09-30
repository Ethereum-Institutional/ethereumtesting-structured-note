import { notFound } from "next/navigation";
import { currentOperator } from "@/lib/access";
import { getStore, type Registrant } from "@/lib/store";
import { explorerAddress, explorerTx } from "@/lib/explorer";
import { bankConfig, corporateIdentities, type IssuedCredential } from "@/lib/admission/bank";
import { policyConfig } from "@/lib/admission/protocol";
import { admitCustodiedAction, advanceAdmissionAction, decideAction, decideAdmissionAction, finishCustodiedAction, offboardAction, revokeAtBankAction, reviewSelfCustodyAction } from "../actions";
import { AnchorWatch } from "../AnchorWatch";
import { PendingButton } from "../PendingButton";
import { Bar } from "../Bar";
import { NUMERIC } from "@/lib/admission/assess";
import { JurisdictionSelect, ScreeningDate } from "./RecordFields";

export const dynamic = "force-dynamic";

/** The pool gate's screening maximum age (script/01_DeployVenue.s.sol, SCREENING_MAX_AGE). */
const SCREENING_MAX_AGE_DAYS = 30;

/** What the bank states from its own file about the client (ADR 0054). */
function BankRecordFields() {
  return (
    <>
      <label>Legal name<input name="legalName" required maxLength={200} /></label>
      <JurisdictionSelect allowed={Object.keys(NUMERIC)} />
      <label>
        Status
        <select name="status" defaultValue="active"><option value="active">Active</option><option value="suspended">Suspended</option></select>
      </label>
      <ScreeningDate maxAgeDays={SCREENING_MAX_AGE_DAYS} />
      <label>
        Investor class
        <select name="investorClass" defaultValue=""><option value="">Institutional (by policy)</option><option value="professional">Professional</option></select>
      </label>
    </>
  );
}

type Clients = { list: IssuedCredential[] } | { error: string };

/** The bank's clients with a live corporate identity, for its staff to choose from (ADR 0057). */
async function bankClients(): Promise<Clients> {
  try {
    const list = await corporateIdentities(bankConfig(), policyConfig().schemas.corporateIdentity, Math.floor(Date.now() / 1000));
    return { list };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

/** Where the bank's staff issue a new client's corporate identity (ADR 0065); set per deployment. */
function IssueAtBank() {
  const url = process.env.BANK_CONSOLE_URL?.trim();
  if (!url) return null;
  return (
    <span className="muted">
      Client not listed? <a href={url} target="_blank" rel="noreferrer">Issue its corporate identity at the bank</a>, then reload this page.
    </span>
  );
}

/** The client's reference at the bank: chosen from the bank's own list, typed only if the list is unavailable. */
function ClientReference({ clients, known }: { clients: Clients; known?: string }) {
  if ("error" in clients) {
    return (
      <label>
        Client reference at the bank
        <input name="kycReference" required maxLength={200} defaultValue={known} />
        <span className="muted">The bank's client list is unavailable ({clients.error}).</span>
      </label>
    );
  }
  const day = (sec: number) => new Date(sec * 1000).toISOString().slice(0, 10);
  return (
    <label>
      Client (corporate identity at the bank)
      <select name="kycReference" required defaultValue={clients.list.some((c) => c.kycReference === known) ? known : ""}>
        <option value="" disabled>Choose the client…</option>
        {clients.list.map((c) => (
          <option key={c.kycReference} value={c.kycReference}>
            {c.kycReference}, issued {day(c.issuedAt)}, to {day(c.expiresAt)}
          </option>
        ))}
      </select>
      <IssueAtBank />
    </label>
  );
}

/** Offboarding and revocation for an admitted account (ADRs 0063, 0064): each folded away until wanted. */
function AdmittedActions({ id, affected }: { id: string; affected: number }) {
  return (
    <div className="stack-actions">
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
function Linked({ href, children }: { href: string | null; children: React.ReactNode }) {
  return href ? <a href={href} target="_blank" rel="noreferrer">{children}</a> : <>{children}</>;
}

const when = (iso: string | null) => (iso ? iso.slice(0, 16).replace("T", " ") + " UTC" : "");

function Decide({ r, self }: { r: Registrant; self: boolean }) {
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

export default async function Operator() {
  const op = await currentOperator();
  if (!op) notFound();
  const store = getStore();
  const [rows, log, admissions, clients] = await Promise.all([store.listRegistrants(), store.auditLog(50), store.listAdmissions(30), bankClients()]);
  const queue = admissions.filter((a) => a.route === "self-custody" && a.status === "awaiting-bank-review");
  // How many admitted wallets rest on each corporate identity: what revoking it would withdraw.
  const resting = new Map<string, number>();
  for (const x of await store.listAdmissions(500)) {
    const cid = (x.data as Record<string, any>).assessment?.attestation?.primaryCredential?.toLowerCase();
    if (x.status === "admitted" && cid) resting.set(cid, (resting.get(cid) ?? 0) + 1);
  }
  const order = { pending: 0, approved: 1, unverified: 2, revoked: 3 } as const;
  rows.sort((a, b) => order[a.status] - order[b.status]);
  return (
    <div className="wrap">
      <Bar who={op} operator />
      <header className="masthead" style={{ paddingBottom: "1rem" }}>
        <p className="eyebrow">Operator</p>
        <h1 style={{ fontSize: "2.5rem" }}>Operator</h1>
      </header>
      <h2 id="access" style={{ marginTop: 0 }}>Access requests</h2>
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
        <form action={admitCustodiedAction} className="stack">
          <div className="fields">
            <ClientReference clients={clients} />
            <label>Custody account reference<input name="clientRef" required maxLength={64} /></label>
            <label>Client instruction reference<input name="instructionRef" required maxLength={200} /></label>
            <BankRecordFields />
          </div>
          <div className="actions">
            <PendingButton working="Opening the custody account, binding its wallet with the bank, writing both grants and setting its trading approvals. This takes up to a minute; keep this page open.">
              Admit
            </PendingButton>
          </div>
        </form>
      </section>

      <h2 id="self-custody">Self-custody requests</h2>
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
                <BankRecordFields />
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

      <h2 id="admissions">Pool admissions</h2>
      <AnchorWatch ids={admissions.filter((a) => a.status === "awaiting-anchor").map((a) => a.id)} advance={advanceAdmissionAction} />
      <div className="table-wrap panel">
        <table style={{ whiteSpace: "nowrap" }}>
          <thead>
            <tr>
              <th>Started</th><th>Route</th><th>Status</th><th>Corporation</th><th>Officer</th><th>Wallet</th>
              <th>Wallet type</th><th>Jurisdiction</th><th>Class</th><th>Pool grant to</th><th>Pool grant</th>
              <th>Registry grant</th><th>Trading approvals</th><th>Anchored</th><th>Problem</th><th />
            </tr>
          </thead>
          <tbody>
            {admissions.map((a) => {
              const d = a.data as Record<string, any>;
              const s = d.assessment?.ok ? d.assessment.summary : null;
              const w = d.written as { chainId?: number; poolGrantTx?: string; registryGrantTx?: string; readyTx?: string; poolGrantExpiresAt?: number } | undefined;
              const revokedAtBank = ((d.bankRevocations ?? []) as Array<{ which: string; by: string; reason: string }>)
                .map((r) => `${r.which === "wallet" ? "Wallet credential" : "Corporate identity"} revoked at the bank by ${r.by}: ${r.reason}.`)
                .join(" ");
              const problem =
                a.status === "offboarded"
                  ? `Offboarded by ${d.offboarded?.by} on ${when(d.offboarded?.at ?? null)}: ${d.offboarded?.reason} ${revokedAtBank}`
                  : revokedAtBank && a.status === "admitted"
                  ? `${revokedAtBank} Offboard it to remove its grants now; otherwise anyone can void its pool grant once the revocation is on-chain.`
                  : a.status === "awaiting-anchor"
                  ? `Waiting for the bank to anchor ${d.anchoring?.pending?.length ?? "its"} credential${d.anchoring?.pending?.length === 1 ? "" : "s"} (since ${when(d.anchorSince ?? a.createdAt).slice(11)}); usually about a minute.`
                  : d.assessment && !d.assessment.ok ? d.assessment.problems.join(" ") : w ? "" : d.error ?? "";
              const anchorTxs = [...new Set(((d.anchors ?? []) as Array<{ anchorTx: string }>).map((x) => x.anchorTx))];
              const tx = (hash: string | undefined) =>
                hash ? <Linked href={explorerTx(w?.chainId, hash)}>{`${hash.slice(0, 10)}…`}</Linked> : "";
              return (
                <tr key={a.id}>
                  <td>{when(a.createdAt)}</td>
                  <td>{a.route}</td>
                  <td><span className={`pill ${a.status === "ready" || a.status === "awaiting-anchor" ? "pending" : a.status === "admitted" ? "approved" : a.status === "offboarded" ? "revoked" : ""}`}>{a.status}</span></td>
                  <td>{s?.corporation ?? d.record?.legalName ?? ""}</td>
                  <td>{s?.officerDid ? `${s.role}, ${s.officerDid}` : ""}</td>
                  <td>{s ? <Linked href={explorerAddress(w?.chainId, s.wallet)}>{s.wallet}</Linked> : d.account ? <Linked href={explorerAddress(w?.chainId, d.account)}>{d.account}</Linked> : d.request?.walletAddress ?? ""}</td>
                  <td>{s?.walletType ?? d.request?.addressType ?? ""}</td>
                  <td>{s?.jurisdiction ?? d.record?.jurisdiction ?? ""}</td>
                  <td>{s?.investorClass ?? ""}</td>
                  <td>{w?.poolGrantExpiresAt ? when(new Date(w.poolGrantExpiresAt * 1000).toISOString()) : ""}</td>
                  <td>{tx(w?.poolGrantTx)}</td>
                  <td>{tx(w?.registryGrantTx)}</td>
                  <td>{tx(w?.readyTx)}</td>
                  <td>{anchorTxs.map((h) => <span key={h}>{tx(h)} </span>)}</td>
                  <td style={{ whiteSpace: "normal", minWidth: 280 }}>{problem}</td>
                  <td>
                    {a.route === "custodied" && a.status === "failed" && d.clientRef && (
                      <form action={finishCustodiedAction} className="actions">
                        <input type="hidden" name="id" value={a.id} />
                        <PendingButton className="quiet" working="Setting the trading approvals…">Set trading approvals</PendingButton>
                      </form>
                    )}
                    {a.status === "admitted" && (
                      <AdmittedActions id={a.id} affected={resting.get(String(d.assessment?.attestation?.primaryCredential ?? "").toLowerCase()) ?? 1} />
                    )}
                    {a.status === "offboarded" && (
                      <span className="muted">{tx(d.offboarded?.poolRevokeTx)} {tx(d.offboarded?.registryRevokeTx)}</span>
                    )}
                    {a.status === "ready" && (
                      <div className="actions">
                        <form action={decideAdmissionAction}>
                          <input type="hidden" name="id" value={a.id} />
                          <input type="hidden" name="decision" value="approve" />
                          <PendingButton className="quiet" working="Writing both grants: up to a minute.">Approve and write grants</PendingButton>
                        </form>
                        <form action={decideAdmissionAction}>
                          <input type="hidden" name="id" value={a.id} />
                          <input type="hidden" name="decision" value="decline" />
                          <button type="submit" className="quiet">Decline</button>
                        </form>
                      </div>
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
