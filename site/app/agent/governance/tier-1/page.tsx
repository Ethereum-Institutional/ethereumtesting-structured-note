import { explorerTx } from "@/lib/explorer";
import { loadManifest } from "@/lib/chain/manifest";
import { governanceView, parties } from "@/lib/governance";
import { attemptForcedTransferAction, correctRegisterAction, recoverWalletAction, tier1WithdrawAction } from "../../../actions";
import { ActionForm } from "../../../staff/ActionForm";
import { Linked } from "../../../staff/parts";

export const dynamic = "force-dynamic";

/** Tier 1: the Agent's governance wallet alone, at once, with a written reason (ADRs 0082, 0088; S-25, S-26). */
export default async function Tier1() {
  const [view, accounts] = await Promise.all([governanceView().catch((e) => (e as Error).message), parties().catch(() => [])]);
  if (typeof view === "string") {
    return (<><h2 id="tier-1">Tier 1</h2><section className="panel"><p role="alert" className="notice err">Governance could not be read: {view}</p></section></>);
  }
  const chainId = loadManifest().chainId;
  const holders = accounts.filter((a) => a.units !== "0");
  return (
    <>
      <h2 id="tier-1">Tier 1</h2>
      <section className="panel">
        <p className="muted" style={{ marginTop: 0 }}>
          The Agent's governance wallet acts alone, at once, and only through the controller's typed acts. Each carries a
          written reason, recorded on-chain in full. It owns the note under review ({view.note.total} units outstanding) and
          its registries{view.pool ? ", and governs the pool" : ""}. Notes issued here are administered by the Issuer's key.
        </p>
        <details>
          <summary>Correct the register…</summary>
          <ActionForm action={correctRegisterAction} hidden={{}} label="Correct the register" working="The Agent's governance wallet forces the transfer, with the reason…">
            <p className="muted" style={{ margin: 0 }}>Moves units to match the Register by a forced transfer, the reason emitted with it. The receiving account must be eligible for the note.</p>
            <div className="fields">
              <label>From<select name="from" required defaultValue="">
                <option value="" disabled>Choose the holder…</option>
                {holders.map((a) => <option key={a.address} value={a.address}>{a.name} ({a.units} units)</option>)}
              </select></label>
              <label>To<select name="to" required defaultValue="">
                <option value="" disabled>Choose the account…</option>
                {accounts.map((a) => <option key={a.address} value={a.address}>{a.name}</option>)}
              </select></label>
              <label>Units<input name="units" type="number" min={1} step={1} defaultValue={1} required /></label>
            </div>
            <label>Written reason<input name="reason" required maxLength={500} placeholder="Lost key reported on …; units restored to the holder's replacement wallet" /></label>
          </ActionForm>
        </details>
        <details style={{ marginTop: "0.75rem" }}>
          <summary>Recover a lost wallet…</summary>
          <ActionForm action={recoverWalletAction} hidden={{}} label="Recover the units" working="The Agent's governance wallet recovers the units to the new wallet…">
            <p className="muted" style={{ margin: 0 }}>
              A holder reports a lost key (S-25): its units, frozen ones included, move to its new wallet, and its identity is
              registered to the new wallet in place of the lost one. Refused while transfers are stopped at a record time.
            </p>
            <div className="fields">
              <label>Lost wallet<select name="lost" required defaultValue="">
                <option value="" disabled>Choose the holder…</option>
                {holders.map((a) => <option key={a.address} value={a.address}>{a.name} ({a.units} units)</option>)}
              </select></label>
              <label>New wallet<input name="replacement" required pattern="0x[0-9a-fA-F]{40}" placeholder="0x…" /></label>
            </div>
            <label>Written reason<input name="reason" required maxLength={500} placeholder="Lost key reported on …; units recovered to the holder's new wallet" /></label>
          </ActionForm>
        </details>
        <details style={{ marginTop: "0.75rem" }}>
          <summary>Freeze an account{view.pool ? ", or withdraw or restore pool access" : ""}…</summary>
          <ActionForm action={tier1WithdrawAction} hidden={{}} label="Act" working="The Agent's governance wallet acts…">
            <p className="muted" style={{ margin: 0 }}>The supervisory stop, whichever institution vouched for the account (ADR 0004): a frozen account can neither send nor receive the note.</p>
            <div className="fields">
              <label>Act<select name="what" defaultValue="freeze">
                <option value="freeze">Freeze the account on the note</option>
                <option value="unfreeze">Unfreeze it</option>
                {view.pool && <option value="pool">Withdraw pool access</option>}
                {view.pool && <option value="restore-pool">Restore pool access</option>}
              </select></label>
              <label>Account<select name="account" required defaultValue="">
                <option value="" disabled>Choose the account…</option>
                {accounts.map((a) => <option key={a.address} value={a.address}>{a.name}</option>)}
              </select></label>
            </div>
            <label>Written reason<input name="reason" required maxLength={500} /></label>
          </ActionForm>
        </details>
        <details style={{ marginTop: "0.75rem" }}>
          <summary>Outside the control framework (S-26)…</summary>
          <ActionForm action={attemptForcedTransferAction} hidden={{}} label="Attempt a forced transfer as the Agent" working="Simulating the Agent's servicing wallet forcing a transfer…" quiet>
            <p className="muted" style={{ margin: 0 }}>
              Simulates the Agent's servicing wallet forcing a transfer on the note directly, not through the controller.
              Nothing is sent; the note's refusal is shown.
            </p>
          </ActionForm>
        </details>
      </section>

      <h3>Tier 1 record</h3>
      {view.tier1.length === 0 ? (
        <section className="panel"><p className="muted" style={{ margin: 0 }}>No Tier 1 act yet.</p></section>
      ) : (
        <div className="table-wrap panel" aria-label="Tier 1 record">
          <table>
            <thead><tr><th>Act</th><th>Written reason</th><th>Transaction</th></tr></thead>
            <tbody>
              {view.tier1.map((t) => (
                <tr key={t.tx}><td>{t.action}</td><td style={{ whiteSpace: "normal" }}>{t.reason}</td><td><Linked href={explorerTx(chainId, t.tx)}>{`${t.tx.slice(0, 10)}…`}</Linked></td></tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
