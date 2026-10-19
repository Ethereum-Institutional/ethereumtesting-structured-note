import Link from "next/link";
import { notesOnRecord } from "@/lib/notes/registry";

export const dynamic = "force-dynamic";

/** Every note on record, each with its reconciliation statement. */
export default async function Reconciliation() {
  const notes = await notesOnRecord().catch((e) => (e as Error).message);
  if (typeof notes === "string") {
    return (<><h2 id="reconciliation">Reconciliation</h2><section className="panel"><p role="alert" className="notice err">The notes could not be read: {notes}</p></section></>);
  }
  return (
    <>
      <h2 id="reconciliation">Reconciliation</h2>
      <p className="muted">
        A statement for each note the note factory issued, as at the close of any day since its issuance, or now: every position,
        the cash, the distributions and the open offers, read from the chain at one block.
      </p>
      <div className="table-wrap panel">
        <table>
          <thead><tr><th>Note</th><th>Issued</th><th /></tr></thead>
          <tbody>
            {notes.map((n) => (
              <tr key={n.token}>
                <td>{n.name} ({n.symbol}){n.underReview && <> <span className="pill approved">under review</span></>}</td>
                <td>{new Date(n.issuedAt * 1000).toISOString().slice(0, 10)}, block {String(n.issuedBlock)}</td>
                <td><Link href={`/agent/reconciliation/${n.token}`}>Statement</Link></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
