import { recentActivity } from "@/lib/activity";
import { Panel } from "@/components/ui";
import { Activity } from "@/components/Activity";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/** The chain's own record of everything done here, decoded. Read-only by nature. */
export default async function LedgerPage() {
  let rows;
  try {
    rows = await recentActivity();
  } catch {
    return <p className="text-xs" style={{ color: "var(--bad)" }}>Cannot reach the chain.</p>;
  }
  return (
    <div data-tour="ledger">
      <Panel
        title="The public ledger"
        subtitle="Decoded from the chain's own transaction log — no application log that could disagree with it"
      >
        <Activity rows={rows} />
      </Panel>
    </div>
  );
}
