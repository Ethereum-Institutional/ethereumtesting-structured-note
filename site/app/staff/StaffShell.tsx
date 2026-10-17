import { notFound } from "next/navigation";
import Link from "next/link";
import { formatEther } from "viem";
import { currentStaff } from "@/lib/access";
import { lowKeys } from "@/lib/chain/keys";
import { kick } from "@/lib/jobs";
import { ROLE_LABEL, type Role } from "@/lib/operators";
import { Bar } from "../Bar";
import { ConsoleNav, type NavItem } from "../ConsoleNav";

/**
 * Every staff portal (ADR 0089): its own role only, the navigation column beside it, and a warning
 * when any key the deployment signs with is low on ETH for fees (ADR 0080); and each load carries
 * the background jobs on.
 */
export async function StaffShell({ role, items, children }: { role: Role; items: NavItem[]; children: React.ReactNode }) {
  const who = await currentStaff(role);
  if (!who) notFound();
  const low = await lowKeys().catch(() => []);
  // Every staff page load carries the background jobs on, after the page is sent (ADR 0116).
  await kick();
  return (
    <div className="wrap">
      <Bar who={who} />
      <header className="masthead" style={{ padding: "2.5rem 0 1.75rem", marginBottom: "2rem" }}>
        <p className="eyebrow">Staff portal</p>
        <h1 style={{ fontSize: "2.25rem" }}>{ROLE_LABEL[role]}</h1>
      </header>
      {low.length > 0 && (
        <p role="alert" className="notice err" style={{ marginBottom: "1.5rem" }}>
          Low on ETH for fees: {low.map((k) => `${k.label} (${Number(formatEther(k.balance)).toLocaleString("en-GB", { maximumFractionDigits: 6 })} ETH)`).join(", ")}.{" "}
          <Link href="/agent/keys">Top up under Agent → Keys</Link>.
        </p>
      )}
      <div className="console">
        <ConsoleNav label={ROLE_LABEL[role]} items={items} />
        <div className="console-main">{children}</div>
      </div>
    </div>
  );
}
