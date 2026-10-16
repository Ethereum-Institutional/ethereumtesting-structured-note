import { currentStaff } from "@/lib/access";
import { isAdmin } from "@/lib/operators";
import { getStore } from "@/lib/store";
import { deleteRegistrationAction } from "../actions";
import { ActionForm } from "../staff/ActionForm";
import { Decide, when } from "../staff/parts";

export const dynamic = "force-dynamic";

/** Sign-ups: the bank approves who may use the site, its clients and its staff alike; an admin may delete a registration (ADR 0100). */
export default async function SignUps() {
  const op = (await currentStaff("bank"))!;
  const admin = isAdmin(op.email);
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
                <td>
                  <Decide r={r} self={r.email === op.email} />
                  {admin && r.email !== op.email && (
                    <details>
                      <summary>Delete…</summary>
                      <ActionForm action={deleteRegistrationAction} hidden={{ id: r.id }} label="Delete permanently" working="Deleting…" quiet>
                        <p className="muted" style={{ margin: 0 }}>
                          Removes the registration, its sessions and its onboarding requests. The audit log keeps the deletion, and the
                          address may register again. Refused while the person has an identity on the chain.
                        </p>
                      </ActionForm>
                    </details>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
