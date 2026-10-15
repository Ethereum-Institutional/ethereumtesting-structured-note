import { getStore } from "@/lib/store";
import { when } from "../../staff/parts";

export const dynamic = "force-dynamic";

export default async function Audit() {
  const log = await getStore().auditLog(200);
  return (
    <>
      <h2 id="audit">Audit log</h2>
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
    </>
  );
}
