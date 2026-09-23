import { notFound } from "next/navigation";
import { currentOperator } from "@/lib/access";
import { getStore, type Registrant } from "@/lib/store";
import { decideAction } from "../actions";
import { Bar } from "../Bar";

export const dynamic = "force-dynamic";

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
  const [rows, log] = await Promise.all([store.listRegistrants(), store.auditLog(50)]);
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
