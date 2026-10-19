import Link from "next/link";
import { notFound } from "next/navigation";
import { noteOnRecord } from "@/lib/notes/registry";
import { daysOf, parseAsAt, statementOf } from "@/lib/notes/reconcile";
import { termSheetByHash } from "@/lib/notes/termsheets";
import { StatementPanel } from "../StatementPanel";
import { TermSheetView } from "../TermSheetView";

export const dynamic = "force-dynamic";

/** One note's reconciliation statement, as at a day, now, or a block. */
export default async function NoteReconciliation({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ asAt?: string }> }) {
  const { token } = await params;
  const { asAt = "now" } = await searchParams;
  const rec = await noteOnRecord(token).catch(() => null);
  if (!rec) notFound();
  const [statement, days] = await Promise.all([statementOf(rec, parseAsAt(asAt)).catch((e) => (e as Error).message), daysOf(rec)]);
  const download = (a: string, format: "json" | "csv") => `/agent/reconciliation/${rec.token}/statement?asAt=${encodeURIComponent(a)}&format=${format}`;
  return (
    <>
      <p><Link href="/agent/reconciliation">← Reconciliation</Link></p>
      <h2 id="statement">{rec.name} ({rec.symbol})</h2>
      <form className="fields panel" method="get" aria-label="As at">
        <label>As at the close of<input type="date" name="asAt" defaultValue={/^\d{4}-\d{2}-\d{2}$/.test(asAt) ? asAt : ""} /></label>
        <button type="submit">Show</button>
        <Link href={`/agent/reconciliation/${rec.token}?asAt=now`}>Now</Link>
      </form>
      {typeof statement === "string" ? (
        <section className="panel"><p role="alert" className="notice err">The statement could not be read: {statement}</p></section>
      ) : (
        <StatementPanel s={statement} downloads={{ json: download(asAt, "json"), csv: download(asAt, "csv") }} />
      )}
      {typeof statement !== "string" && statement.termSheet && (
        <>
          <h3 id="term-sheet">Term sheet</h3>
          <TermSheetPanel hash={statement.termSheet.hash} />
        </>
      )}
      <h3 id="days">Each day</h3>
      <div className="table-wrap panel">
        <table aria-label="Statements by day">
          <thead><tr><th>As at the close of</th><th>Download</th></tr></thead>
          <tbody>
            {days.map((d) => (
              <tr key={d}>
                <td><Link href={`/agent/reconciliation/${rec.token}?asAt=${d}`}>{d}</Link></td>
                <td><a href={download(d, "json")} download>JSON</a> · <a href={download(d, "csv")} download>CSV</a></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

async function TermSheetPanel({ hash }: { hash: string }) {
  const record = await termSheetByHash(hash);
  if (!record) return <section className="panel"><p className="muted" style={{ margin: 0 }}>The term sheet {hash} is not held here.</p></section>;
  return <TermSheetView t={record} hash={hash} href={`/term-sheets/${hash}`} />;
}
