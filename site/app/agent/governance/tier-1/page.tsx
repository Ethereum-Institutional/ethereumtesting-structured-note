import { explorerTx } from "@/lib/explorer";
import { loadManifest } from "@/lib/chain/manifest";
import { governanceView, parties } from "@/lib/governance";
import { attemptForcedTransferAction, correctRegisterAction, recoverWalletAction, tier1WithdrawAction } from "../../../actions";
import { ActionForm } from "../../../staff/ActionForm";
import { Linked } from "../../../staff/parts";
import { Address } from "../../../Address";
import { NotePicker } from "../NotePicker";

export const dynamic = "force-dynamic";

/** Tier 1: the Agent's governance wallet alone, at once, with a written reason, on the note chosen or on every note. */
export default async function Tier1({ searchParams }: { searchParams: Promise<{ note?: string }> }) {
  const chosen = (await searchParams).note;
  const view = await governanceView(chosen).catch((e) => (e as Error).message);
  if (typeof view === "string") {
    return (<><h2 id="tier-1">Tier 1</h2><section className="panel"><p role="alert" className="notice err">Governance could not be read: {view}</p></section></>);
  }
  const accounts = await parties(view.note.address).catch(() => []);
  const chainId = loadManifest().chainId;
  const holders = accounts.filter((a) => a.units !== "0");
  const token = { token: view.note.address };
  const sym = view.note.symbol;
  return (
    <>
      <h2 id="tier-1">Tier 1</h2>
      <section className="panel">
        <NotePicker notes={view.notes} chosen={view.note.address} />
        <dl className="facts" aria-label="The note chosen">
          <dt>Acts on</dt>
          <dd><strong>{view.note.name}</strong> ({sym}): <Address value={view.note.address} /></dd>
          <dt>Units</dt>
          <dd>{view.note.total} outstanding, {view.note.inventory} of them in the Issuer's inventory{view.note.paused ? "; transfers are paused" : ""}</dd>
        </dl>
        <p className="muted" style={{ marginTop: 0 }}>
          The Agent's governance wallet acts alone, at once, and only through the controller's typed acts. Each carries a
          written reason, recorded on-chain in full. The controller governs every note the programme issues{view.pool ? ", and the pool" : ""}:
          correcting a register acts on the note chosen above; recovering a wallet acts on every note it holds; a freeze can cover one note or all of them.
        </p>
        <details>
          <summary title={`Moves units of ${sym} between accounts by a forced transfer, with a written reason.`}>Correct the register of {sym}…</summary>
          <ActionForm action={correctRegisterAction} hidden={token} label={`Correct the register of ${sym}`} working="The Agent's governance wallet forces the transfer, with the reason…">
            <p className="muted" style={{ margin: 0 }}>Moves units of {sym} from one account to another, to match the Register, by a forced transfer: the reason is recorded with it. The receiving account must be eligible for the notes.</p>
            <div className="fields">
              <label>From<select name="from" required defaultValue="">
                <option value="" disabled>Choose the holder…</option>
                {holders.map((a) => <option key={a.address} value={a.address}>{a.name} ({a.units} units of {sym})</option>)}
              </select></label>
              <label>To<select name="to" required defaultValue="">
                <option value="" disabled>Choose the account…</option>
                {accounts.map((a) => <option key={a.address} value={a.address}>{a.name}</option>)}
              </select></label>
              <label>Units of {sym}<input name="units" type="number" min={1} step={1} defaultValue={1} required /></label>
            </div>
            <label>Written reason<input name="reason" required maxLength={500} placeholder="Settlement instruction of … booked to the wrong account; units moved to the buyer" /></label>
          </ActionForm>
        </details>
        <details style={{ marginTop: "0.75rem" }}>
          <summary>Recover a lost wallet, on every note it holds…</summary>
          <ActionForm action={recoverWalletAction} hidden={{}} label="Recover the units" working="The Agent's governance wallet recovers the units to the new wallet…">
            <p className="muted" style={{ margin: 0 }}>
              A holder reports a lost key: its units of every note, frozen ones included, move to its new wallet, and its identity is
              registered to the new wallet in place of the lost one. Refused while any of those notes has transfers stopped at a record time.
            </p>
            <div className="fields">
              <label>Lost wallet<select name="lost" required defaultValue="">
                <option value="" disabled>Choose the holder…</option>
                {accounts.map((a) => <option key={a.address} value={a.address}>{a.name}{a.units !== "0" ? ` (${a.units} units of ${sym})` : ""}</option>)}
              </select></label>
              <label>New wallet<input name="replacement" required pattern="0x[0-9a-fA-F]{40}" placeholder="0x…" /></label>
            </div>
            <label>Written reason<input name="reason" required maxLength={500} placeholder="Lost key reported on …; units recovered to the holder's new wallet" /></label>
          </ActionForm>
        </details>
        <details style={{ marginTop: "0.75rem" }}>
          <summary>Freeze an account, designate it under sanctions{view.pool ? ", or withdraw its pool access" : ""}…</summary>
          <ActionForm action={tier1WithdrawAction} hidden={token} label="Act" working="The Agent's governance wallet acts…">
            <p className="muted" style={{ margin: 0 }}>
              The supervisory stop, whichever institution vouched for the account: a frozen account can neither send nor receive the note.
              A sanctions designation stops it on every note at once, now and on every note issued later, until it is lifted.
            </p>
            <div className="fields">
              <label>Act<select name="what" defaultValue="freeze">
                <option value="freeze">Freeze the account</option>
                <option value="unfreeze">Unfreeze it</option>
                <option value="designate">Designate it under sanctions (every note)</option>
                <option value="undesignate">Lift its sanctions designation</option>
                {view.pool && <option value="pool">Withdraw pool access</option>}
                {view.pool && <option value="restore-pool">Restore pool access</option>}
              </select></label>
              <label title="Freezing and unfreezing only: on the note chosen above, or on every note the controller governs.">Freeze on<select name="scope" defaultValue="this">
                <option value="this">{sym} only</option>
                <option value="every">Every note ({view.notes.length})</option>
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
          <summary>Outside the control framework…</summary>
          <ActionForm action={attemptForcedTransferAction} hidden={token} label="Attempt a forced transfer as the Agent" working="Simulating the Agent's servicing wallet forcing a transfer…" quiet>
            <p className="muted" style={{ margin: 0 }}>
              Simulates the Agent's servicing wallet forcing a transfer on {sym} directly, not through the controller.
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
            <thead><tr><th>Note</th><th>Act</th><th>Written reason</th><th>Transaction</th></tr></thead>
            <tbody>
              {view.tier1.map((t, i) => (
                <tr key={`${t.tx}/${i}`}><td>{t.note}</td><td>{t.action}</td><td style={{ whiteSpace: "normal" }}>{t.reason}</td><td><Linked href={explorerTx(chainId, t.tx)}>{`${t.tx.slice(0, 10)}…`}</Linked></td></tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
