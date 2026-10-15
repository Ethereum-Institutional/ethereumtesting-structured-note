import { currentStaff } from "@/lib/access";
import { getStore } from "@/lib/store";
import { Decide, when } from "../staff/parts";

export const dynamic = "force-dynamic";

/** Sign-ups: the bank approves who may use the site, its clients and its staff alike. */
export default async function SignUps() {
  const op = (await currentStaff("bank"))!;
  const rows = await getStore().listRegistrants();
  const order = { pending: 0, approved: 1, unverified: 2, revoked: 3 } as const;
  rows.sort((a, b) => order[a.status] - order[b.status]);
  return (
    <>
      <h2 id="access">Sign-ups</h2>
      <div className="table-wrap panel">
        <table>
          <thead>
            <tr><th>Status</th><th>Name</th><th>Organisation</th><th>Email</th><th>Registered</th><th>Decided</th><th /></tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>
                  <span className={`pill ${r.status}`}>{r.status}</span>
                  {r.status === "unverified" && <><br /><span className="muted">Hasn't confirmed their email yet</span></>}
                  {r.status === "pending" && <><br /><span className="muted">Email confirmed; awaiting approval</span></>}
                </td>
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
    </>
  );
}
