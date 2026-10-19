import Link from "next/link";
import { bookView, type BookRow, type NextAct } from "@/lib/notes/book";
import { AutoRefresh } from "../../AutoRefresh";
import { when } from "../../staff/parts";

export const dynamic = "force-dynamic";

const t = (s: number) => when(new Date(s * 1000).toISOString());

/**
 * The book: every note the programme issued, with what each needs next, what is running in the
 * background and what waits for a second approver. One row a note, whatever the book's size.
 */
export default async function Book() {
  const book = await bookView().catch((e) => (e as Error).message);
  if (typeof book === "string") {
    return (<><h2 id="book">Book</h2><section className="panel"><p role="alert" className="notice err">The book could not be read: {book}</p></section></>);
  }
  const { totals } = book;
  return (
    <>
      {totals.running > 0 && <AutoRefresh seconds={5} />}
      <h2 id="book">Book</h2>
      <section className="panel">
        <dl className="tiles" aria-label="The book at a glance">
          <div><dt>Notes</dt><dd>{totals.notes}<span className="muted"> ({totals.live} live)</span></dd></div>
          <div><dt>Units outstanding</dt><dd>{String(totals.outstanding)}</dd></div>
          <div className={totals.due ? "attention" : ""}><dt>Due now</dt><dd>{totals.due}</dd></div>
          <div className={totals.awaitingApproval ? "attention" : ""}><dt>Awaiting a second approver</dt><dd>{totals.awaitingApproval}</dd></div>
          <div><dt>Running</dt><dd>{totals.running}</dd></div>
          <div className={totals.failed ? "attention" : ""}><dt>Failed</dt><dd>{totals.failed}</dd></div>
        </dl>
        <p className="muted" style={{ marginBottom: 0 }}>Chain time {t(book.chainNow)}. Each note opens on its own page, where its dates are determined and paid.</p>
      </section>
      <div className="table-wrap panel" aria-label="Every note">
        <table>
          <thead><tr><th>Series</th><th>Note</th><th>Status</th><th>Units</th><th>Dates</th><th>Next</th><th>Desk</th></tr></thead>
          <tbody>
            {book.rows.map((r) => <Row key={r.token} r={r} />)}
          </tbody>
        </table>
      </div>
    </>
  );
}

function Row({ r }: { r: BookRow }) {
  return (
    <tr aria-label={r.symbol}>
      <td data-label="Series">{r.series}{r.isin && <><br /><span className="muted">{r.isin}</span></>}</td>
      <td data-label="Note"><Link href={r.href}>{r.symbol}</Link><br /><span className="muted">{r.name}</span></td>
      <td data-label="Status"><span className={`pill ${r.status === "live" ? "approved" : r.status === "retired" ? "revoked" : "pending"}`}>{r.status}</span>{r.paused && r.status === "live" && <><br /><span className="muted">transfers paused</span></>}</td>
      <td data-label="Units">{r.outstanding} outstanding<br /><span className="muted">{r.inventory} in the Issuer's inventory</span></td>
      <td data-label="Dates">{r.datesDetermined} of {r.dates} determined</td>
      <td data-label="Next" className={"due" in r.next && r.next.due ? "due-now" : ""}>{nextLabel(r.next)}</td>
      <td data-label="Desk">
        {r.awaitingApproval.map((j) => <div key={j.id}><strong>Awaiting approval:</strong> {j.kind} of date {Number(j.data.date) + 1}, proposed by {j.by}</div>)}
        {r.running.map((j) => <div key={j.id}>Running: {j.kind} of date {Number(j.data.date) + 1}{j.error ? `; retrying after: ${j.error}` : ""}</div>)}
        {r.failed.map((j) => <div key={j.id} className="err">Failed: {j.kind} of date {Number(j.data.date) + 1}: {j.error}</div>)}
        {!r.awaitingApproval.length && !r.running.length && !r.failed.length && <span className="muted">–</span>}
      </td>
    </tr>
  );
}

function nextLabel(a: NextAct): string {
  if (a.kind === "none") return a.reason;
  if (a.kind === "determine") return `${a.due ? "Due: determine" : "Determine"} date ${a.date + 1}${a.due ? "" : ` from ${t(a.at)}`}`;
  return `${a.due ? "Due: pay" : "Pay"} date ${a.date + 1}'s ${a.event}${a.due ? "" : ` from ${t(a.at)}`}`;
}
