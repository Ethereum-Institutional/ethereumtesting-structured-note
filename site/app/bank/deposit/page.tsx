import { explorerTx } from "@/lib/explorer";
import { loadManifest } from "@/lib/chain/manifest";
import { depositView, type Holder } from "@/lib/identity/deposit";
import { creditAccountAction, debitDepositAction, enforceDepositAction, holdDepositAction, pauseDepositAction } from "../../actions";
import { ActionForm } from "../../staff/ActionForm";
import { Linked } from "../../staff/parts";

export const dynamic = "force-dynamic";

const amount = (v: bigint, decimals: number) => (Number(v) / 10 ** decimals).toLocaleString("en-GB", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
const short = (a: string) => `${a.slice(0, 10)}…`;

/**
 * The bank's tokenized deposit (ADRs 0086, 0092): its supply, every holder and why it may hold,
 * the bank's acts on each, and every booking and order, read from the chain.
 */
export default async function Deposit() {
  const view = await depositView().catch((e) => (e as Error).message);
  if (typeof view === "string") {
    return (<><h2 id="deposit">The deposit</h2><section className="panel"><p role="alert" className="notice err">The deposit could not be read: {view}</p></section></>);
  }
  const chainId = loadManifest().chainId;
  const show = (v: bigint) => `${amount(v, view.decimals)} ${view.symbol}`;
  const name = (h: Holder) => h.label ?? short(h.account);
  const receivers = view.holders.filter((h) => h.why);
  return (
    <>
      <h2 id="deposit">The deposit</h2>
      <section className="panel" aria-label="The deposit's state">
        <dl className="facts">
          <dt>Outstanding</dt><dd className="deposit-supply">{show(view.supply)}</dd>
          <dt>State</dt><dd><span className={`pill ${view.paused ? "revoked" : "approved"}`}>{view.paused ? "paused" : "moving"}</span></dd>
        </dl>
        <details>
          <summary title={view.paused ? "Lets transfers, credits and debits move again." : "Stops every transfer, credit and debit at once, and with them the pool and settlement."}>{view.paused ? "Resume the deposit…" : "Pause the deposit…"}</summary>
          <ActionForm action={pauseDepositAction} hidden={{ pause: view.paused ? "0" : "1" }} label={view.paused ? "Resume" : "Pause"} working={view.paused ? "Resuming…" : "Pausing…"}>
            <p className="muted" style={{ margin: 0 }}>
              {view.paused ? "Transfers, credits and debits move again." : "Every transfer, credit and debit stops at once, and with them the pool and settlement. An order still moves."}
            </p>
            <label>Reason<input name="reason" required maxLength={500} /></label>
          </ActionForm>
        </details>
      </section>

      <h2 id="holders">Holders</h2>
      {view.holders.length === 0 && <p className="muted panel">No account holds the deposit.</p>}
      {view.holders.length > 0 && (
        <div className="table-wrap panel">
          <table>
            <thead><tr><th>Account</th><th>Balance</th><th>Held</th><th>May hold by</th><th /></tr></thead>
            <tbody>
              {view.holders.map((h) => (
                <tr key={h.account} data-account={h.account}>
                  <td>{name(h)}<br /><code className="muted">{h.account}</code></td>
                  <td className="balance">{show(h.balance)}</td>
                  <td className="held">{h.held > 0n ? show(h.held) : "–"}</td>
                  <td>{h.why === "identity" ? "the bank's claim" : h.why === "allowlist" ? "the allowlist" : <span className="pill revoked">nothing: it cannot move</span>}</td>
                  <td>
                    <details>
                      <summary title="Issues the bank's tokenized deposit into this wallet, as when the client pays money into its account at the bank: the client's cash, now able to settle the note on-chain.">Credit…</summary>
                      <ActionForm action={creditAccountAction} hidden={{ account: h.account }} label="Credit" working="Crediting…" quiet>
                        <p className="muted" style={{ margin: 0 }}>Issues the bank's tokenized deposit into this account, as when the client pays money into its account at the bank: the client's cash, now able to settle the note on-chain. Booked under a fresh reference.</p>
                        <label>Amount<input name="amount" required inputMode="decimal" placeholder="100.00" /></label>
                      </ActionForm>
                    </details>
                    <details>
                      <summary title="Takes deposit out of this account, as when the client withdraws money: paid out to its account at the bank.">Debit…</summary>
                      <ActionForm action={debitDepositAction} hidden={{ account: h.account }} label="Debit" working="Debiting…" quiet>
                        <p className="muted" style={{ margin: 0 }}>Paid out to the client's account at the bank, against a booking. A held amount cannot be debited.</p>
                        <label>Amount<input name="amount" required inputMode="decimal" placeholder="100.00" /></label>
                      </ActionForm>
                    </details>
                    <details>
                      <summary title="Freezes part of the balance, with a reason: it stays the client's but cannot move or be debited until released.">Hold…</summary>
                      <ActionForm action={holdDepositAction} hidden={{ account: h.account }} label="Set the hold" working="Holding…" quiet>
                        <p className="muted" style={{ margin: 0 }}>The whole amount held from now; zero releases it. A held amount cannot move or be debited.</p>
                        <label>Amount held<input name="amount" required inputMode="decimal" defaultValue="0" /></label>
                        <label>Reason<input name="reason" required maxLength={500} /></label>
                      </ActionForm>
                    </details>
                    <details>
                      <summary title="Moves deposit between accounts under a court's or a regulator's order, its reason on-chain. Not for corrections.">Move by order…</summary>
                      <ActionForm action={enforceDepositAction} hidden={{ account: h.account }} label="Move by order" working="Moving by order…" quiet>
                        <p className="muted" style={{ margin: 0 }}>A court's or a regulator's order, its reason recorded on-chain in full. Held or paused, it moves. A correction is a debit and a credit instead.</p>
                        <label>To<select name="to" required defaultValue="">
                          <option value="" disabled>Choose the account…</option>
                          {receivers.filter((r) => r.account !== h.account).map((r) => <option key={r.account} value={r.account}>{name(r)}</option>)}
                        </select></label>
                        <label>Amount<input name="amount" required inputMode="decimal" /></label>
                        <label>The order and its reason<input name="reason" required maxLength={500} /></label>
                      </ActionForm>
                    </details>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h2 id="bookings">Bookings</h2>
      {view.bookings.length === 0 && <p className="muted panel">No credit or debit yet.</p>}
      {view.bookings.length > 0 && (
        <div className="table-wrap panel">
          <table>
            <thead><tr><th>Booking</th><th>Kind</th><th>Account</th><th>Amount</th><th>Transaction</th></tr></thead>
            <tbody>
              {view.bookings.map((b) => (
                <tr key={`${b.tx}-${b.refHash}`}>
                  <td>{b.ref ?? <span className="muted" title={b.refHash}>{short(b.refHash)} (made outside this site)</span>}</td>
                  <td>{b.kind}</td>
                  <td>{b.label ?? short(b.account)}</td>
                  <td>{show(b.amount)}</td>
                  <td><Linked href={explorerTx(chainId, b.tx)}>{short(b.tx)}</Linked></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h2 id="orders">Moved by order</h2>
      {view.enforcements.length === 0 && <p className="muted panel">The bank has moved no deposit by order.</p>}
      {view.enforcements.length > 0 && (
        <div className="table-wrap panel">
          <table>
            <thead><tr><th>From</th><th>To</th><th>Amount</th><th>The order and its reason</th><th>Transaction</th></tr></thead>
            <tbody>
              {view.enforcements.map((e) => (
                <tr key={e.tx}>
                  <td>{e.fromLabel ?? short(e.from)}</td>
                  <td>{e.toLabel ?? short(e.to)}</td>
                  <td>{show(e.amount)}</td>
                  <td style={{ whiteSpace: "normal" }}>{e.reason}</td>
                  <td><Linked href={explorerTx(chainId, e.tx)}>{short(e.tx)}</Linked></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
