import type { Statement } from "@/lib/notes/reconcile";

const euros = (cents: string) => `€${(Number(cents) / 100).toLocaleString("en-GB", { minimumFractionDigits: 2 })}`;
const when = (iso: string) => iso.slice(0, 16).replace("T", " ") + " UTC";
const short = (a: string) => `${a.slice(0, 10)}…`;

/** A note's reconciliation statement (ADR 0094): its headline, its checks, the positions, cash, distributions and open offers. */
export function StatementPanel({ s, downloads }: { s: Statement; downloads: { json: string; csv: string } }) {
  const failing = s.checks.filter((x) => !x.ok).length;
  const headline = s.closed
    ? `Closed: every position is at zero. Read from the chain at block ${s.block}, ${when(s.at)}.`
    : s.state === "redeemed"
      ? `Redeemed, not closed: ${failing} check(s) fail, as at ${s.asAt}, block ${s.block}.`
      : failing
        ? `Not reconciled: ${failing} check(s) fail, as at ${s.asAt}, block ${s.block}.`
        : `Reconciled: every check passes, as at ${s.asAt}, block ${s.block}, ${when(s.at)}.`;
  return (
    <section className="panel" aria-label="Reconciliation">
      <p className={failing ? "notice err" : "notice ok"} role="status" style={{ marginTop: 0 }}>{headline}</p>
      <ul className="plain" aria-label="Reconciliation checks">
        {s.checks.map((x) => (
          <li key={x.label}><strong>{x.ok ? "✓" : "✗"} {x.label}.</strong> <span className="muted">{x.detail}</span></li>
        ))}
      </ul>

      <h4>Positions</h4>
      <div className="table-wrap">
        <table aria-label="Positions">
          <thead><tr><th>Account</th><th>Units in</th><th>Units out</th><th>Balance</th><th>Locked</th><th>Eligible</th><th>Coupons</th><th>Redemption</th><th>Held</th></tr></thead>
          <tbody>
            {s.positions.map((p) => (
              <tr key={p.account}>
                <td>{p.label ?? short(p.account)}</td>
                <td>{p.unitsIn}</td>
                <td>{p.unitsOut}</td>
                <td>{p.balance}</td>
                <td>{p.lockedUnits === "0" ? "–" : p.lockedUnits}</td>
                <td>{p.balance === "0" ? "–" : p.eligible ? "yes" : <span className="pill revoked">no</span>}</td>
                <td>{euros(p.couponCents)}</td>
                <td>{euros(p.redemptionCents)}</td>
                <td>{euros(p.heldCents)}</td>
              </tr>
            ))}
            <tr>
              <td><strong>Total</strong></td><td /><td /><td><strong>{s.totals.units}</strong></td><td /><td />
              <td><strong>{euros(s.totals.couponCents)}</strong></td><td><strong>{euros(s.totals.redemptionCents)}</strong></td><td><strong>{euros(s.totals.heldCents)}</strong></td>
            </tr>
          </tbody>
        </table>
      </div>

      <h4>Cash</h4>
      <dl className="facts" aria-label="Cash">
        <dt>The Paying Agent holds</dt><dd>{euros(s.cash.payingAgentCents)}, and owes {euros(s.cash.owedByPayingAgentCents)}</dd>
        <dt>The settlement contract holds</dt><dd>{euros(s.cash.settlementCents)}</dd>
        <dt>The Agent's funding</dt><dd>{euros(s.cash.funder.balanceCents)}, of which the Paying Agent may draw {BigInt(s.cash.funder.allowanceCents) > 10n ** 30n ? "all" : euros(s.cash.funder.allowanceCents)}</dd>
        <dt>The Issuer's inventory</dt><dd>{s.inventory.units} unit(s)</dd>
      </dl>

      <h4>Distributions</h4>
      {s.distributions.length === 0 ? (
        <p className="muted">None opened yet.</p>
      ) : (
        <div className="table-wrap">
          <table aria-label="Distributions">
            <thead><tr><th>Date</th><th>Kind</th><th>Record time</th><th>Per unit</th><th>Units paid</th><th>Paid</th><th>Held</th><th>Still owed</th><th /></tr></thead>
            <tbody>
              {s.distributions.map((d) => (
                <tr key={`${d.date}-${d.kind}`}>
                  <td>{d.date + 1}</td>
                  <td>{d.kind}</td>
                  <td>{when(new Date(d.recordTime * 1000).toISOString())}</td>
                  <td>{euros(d.perCaCents)}</td>
                  <td>{d.unitsPaid} of {d.unitsEntitled}</td>
                  <td>{euros(d.paidCents)}</td>
                  <td>{euros(d.heldCents)}</td>
                  <td>{euros(d.remainingCents)}</td>
                  <td><span className={`pill ${d.state === "closed" ? "approved" : "pending"}`}>{d.state}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h4>Open offers</h4>
      {s.openOffers.length === 0 ? (
        <p className="muted">None.</p>
      ) : (
        <div className="table-wrap">
          <table aria-label="Open offers">
            <thead><tr><th>Offer</th><th>Kind</th><th>Units</th><th>Price</th><th>Until</th></tr></thead>
            <tbody>
              {s.openOffers.map((o) => (
                <tr key={o.id}><td>{o.id}</td><td>{o.kind}, to {o.side}</td><td>{o.units}</td><td>{euros(o.priceCents)}</td><td>{when(new Date(o.deadline * 1000).toISOString())}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="muted" style={{ marginBottom: 0 }}>
        Download this statement: <a href={downloads.json} download>JSON</a>, with every figure and check, for the evidence pack; <a href={downloads.csv} download>CSV</a>, the
        positions, for reconciliation tools. Anyone with the chain can reproduce it from block {s.block}.
      </p>
    </section>
  );
}
