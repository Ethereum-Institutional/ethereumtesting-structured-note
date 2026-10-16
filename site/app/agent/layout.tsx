import { lowKeys } from "@/lib/chain/keys";
import { kick } from "@/lib/jobs";
import { StaffShell } from "../staff/StaffShell";

export const dynamic = "force-dynamic";

/** The Agent's portal: the notes and their lifecycle, governance, keys, and the participants without their facts (ADR 0089). */
export default async function AgentLayout({ children }: { children: React.ReactNode }) {
  const low = await lowKeys().catch(() => []);
  // Every staff page load carries the background jobs on, after the page is sent (ADR 0116).
  await kick();
  return (
    <StaffShell
      role="agent"
      items={[
        { href: "/agent", label: "Participants" },
        { href: "/agent/notes", label: "Notes" },
        { href: "/agent/reconciliation", label: "Reconciliation" },
        {
          href: "/agent/governance/tier-1",
          label: "Governance",
          children: [
            { href: "/agent/governance/tier-1", label: "Tier 1" },
            { href: "/agent/governance/tier-2", label: "Tier 2" },
          ],
        },
        { href: "/agent/keys", label: "Keys", badge: low.length },
        { href: "/agent/audit", label: "Audit log" },
      ]}
    >
      {children}
    </StaffShell>
  );
}
