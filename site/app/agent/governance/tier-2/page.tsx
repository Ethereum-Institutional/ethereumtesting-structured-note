import { governanceView, KIND_LABEL, KINDS, OFFERED, parties, type ProposalView } from "@/lib/governance";
import { approveProposalAction, cancelProposalAction, executeProposalAction, proposeAction } from "../../../actions";
import { AutoRefresh } from "../../../AutoRefresh";
import { ActionForm } from "../../../staff/ActionForm";
import { when } from "../../../staff/parts";

export const dynamic = "force-dynamic";

const span = (s: number) => (s % 86_400 === 0 ? `${s / 86_400} day${s === 86_400 ? "" : "s"}` : s % 3600 === 0 ? `${s / 3600} hour${s === 3600 ? "" : "s"}` : `${Math.round(s / 60)} minutes`);
const t = (s: number) => when(new Date(s * 1000).toISOString());

/** Tier 2: proposals by the institutions, their approvals, the delay and the window (ADR 0082; S-22, S-24). */
export default async function Tier2() {
  const [view, accounts] = await Promise.all([governanceView().catch((e) => (e as Error).message), parties().catch(() => [])]);
  if (typeof view === "string") {
    return (<><h2 id="tier-2">Tier 2</h2><section className="panel"><p role="alert" className="notice err">Governance could not be read: {view}</p></section></>);
  }
  const queued = view.proposals.some((p) => p.state === "queued");
  return (
    <>
      {queued && <AutoRefresh seconds={30} />}
      <h2 id="tier-2">Tier 2</h2>
      <section className="panel">
        <dl className="facts">
          <dt>Thresholds</dt><dd>At least {view.minInstitutions} institutions, whose wallets need {view.minSignatures} signatures between them</dd>
          <dt>Delay</dt><dd>{span(view.tier2Delay)} on this deployment{view.targetTier2Delay ? `, ${span(view.targetTier2Delay)} in production` : ""}; {span(view.recoveryDelay)} for a recovery</dd>
          <dt>Execution window</dt>
          <dd>{view.executionWindow === null ? "None: this deployment's controller was built before proposals expired, so a proposal stays open until it is executed or cancelled." : `${span(view.executionWindow)} after the delay${view.targetExecutionWindow ? `, ${span(view.targetExecutionWindow)} in production` : ""}; then a proposal expires (S-24)`}</dd>
          <dt>Institutions</dt><dd>{view.institutions.map((i) => i.label).join(", ")}: each a 2-of-3 wallet, whose two owners' keys the site holds</dd>
          <dt>Chain time</dt><dd>{t(view.chainNow)}</dd>
        </dl>
        <details>
          <summary>Propose…</summary>
          <ActionForm action={proposeAction} hidden={{}} label="Propose" working="The institution's wallet proposes, and approves its own proposal…">
            <div className="fields">
              <label>Proposed by<select name="by" defaultValue="issuer">
                {view.institutions.map((i) => <option key={i.key} value={i.key}>The {i.label}</option>)}
              </select></label>
              <label>Act<select name="kind" required defaultValue="AmendNotional">
                {KINDS.map((k) => {
                  const offered = OFFERED.includes(k) && (k !== "SetLiquidityProvider" || view.pool);
                  return <option key={k} value={k} disabled={!offered}>{KIND_LABEL[k]}{offered ? "" : " (not offered from the site)"}</option>;
                })}
              </select></label>
            </div>
            <fieldset className="fields" style={{ border: 0, padding: 0, margin: 0 }}>
              <label>Notional: direction<select name="direction" defaultValue="increase"><option value="increase">Increase (mint to the inventory)</option><option value="reduce">Reduce (burn from the inventory)</option></select></label>
              <label>Notional: units<input name="units" type="number" min={1} step={1} defaultValue={1} /></label>
              <label>Claim issuer<input name="issuer" pattern="0x[0-9a-fA-F]{40}" placeholder="0x…" list="trusted-issuers" /></label>
              <datalist id="trusted-issuers">{view.trustedIssuers.map((a) => <option key={a} value={a} />)}</datalist>
              {view.pool && (
                <label>Liquidity provider<select name="account" defaultValue="">
                  <option value="">Choose the account…</option>
                  {accounts.map((a) => <option key={a.address} value={a.address}>{a.name}</option>)}
                </select></label>
              )}
              <label>Trust or cease / approve or remove<select name="approved" defaultValue="approve"><option value="approve">Trust (approve)</option><option value="remove">Cease (remove)</option></select></label>
            </fieldset>
            <p className="muted" style={{ margin: 0 }}>
              Only the fields for the chosen act are used. The note trusts {view.trustedIssuers.length} claim issuer{view.trustedIssuers.length === 1 ? "" : "s"} now:{" "}
              {view.trustedIssuers.map((a) => <code key={a}>{a} </code>)}. Replacing the servicing wallet or an institution and reversing
              a distribution are Tier 2 acts too, but are not offered from the site: a mistake would break the deployment.
            </p>
            <label>Written reason<input name="reason" required maxLength={500} /></label>
          </ActionForm>
        </details>
      </section>

      <h3>Proposals</h3>
      {view.proposals.length === 0 && <section className="panel"><p className="muted" style={{ margin: 0 }}>No proposal yet.</p></section>}
      <ol className="timeline" aria-label="Proposals">
        {view.proposals.map((p) => <ProposalCard key={p.id} p={p} />)}
      </ol>
    </>
  );
}

function ProposalCard({ p }: { p: ProposalView }) {
  const open = p.state === "awaiting approvals" || p.state === "queued" || p.state === "executable";
  return (
    <li className={`date-card ${p.state === "executed" ? "done" : p.state === "executable" ? "due" : p.state === "expired" || p.state === "cancelled" ? "falls-away" : "todo"}`} aria-label={`Proposal ${p.id}`}>
      <div className="date-head">
        <strong>Proposal {p.id}</strong>
        <span>{p.label}: {p.args}</span>
        <span className={`pill ${p.state === "executed" ? "approved" : p.state === "expired" || p.state === "cancelled" ? "revoked" : "pending"}`}>{p.state}</span>
      </div>
      <p className="muted">By the {p.proposer}. Reason: {p.reason}</p>
      <p>
        {p.institutions} institution{p.institutions === 1 ? "" : "s"} approve, with {p.signatures} signatures between their wallets.
        {p.readyAt ? ` Executable from ${t(p.readyAt)}${p.expiresAt ? ` until ${t(p.expiresAt)}` : ""}.` : " Not queued: the thresholds are not met."}
      </p>
      {open && (
        <div className="actions">
          {p.approvals.filter((a) => !a.approved).map((a) => (
            <ActionForm key={a.key} action={approveProposalAction} hidden={{ id: String(p.id), by: a.key }} label={`Approve as the ${a.label}`} working={`The ${a.label}'s wallet approves…`} quiet />
          ))}
          <ActionForm action={executeProposalAction} hidden={{ id: String(p.id) }} label="Execute" working="Executing through the controller…" />
          <ActionForm action={cancelProposalAction} hidden={{ id: String(p.id) }} label="Cancel" working="The proposer's wallet cancels…" quiet />
        </div>
      )}
      <p className="muted">Approved by: {p.approvals.filter((a) => a.approved).map((a) => a.label).join(", ") || "none"}.</p>
    </li>
  );
}
