import { notFound } from "next/navigation";
import { currentOperator } from "@/lib/access";
import Link from "next/link";
import { formatEther } from "viem";
import { getStore } from "@/lib/store";
import { lowKeys } from "@/lib/chain/keys";
import { Bar } from "../Bar";
import { OperatorNav } from "./OperatorNav";

export const dynamic = "force-dynamic";

/** Every Operator page: staff only, with the navigation column beside it (ADR 0073). */
export default async function OperatorLayout({ children }: { children: React.ReactNode }) {
  const op = await currentOperator();
  if (!op) notFound();
  const [custodyRequests, low] = await Promise.all([
    getStore().listClients().then((cs) => cs.filter((c) => c.custodyRequest).length),
    lowKeys(),
  ]);
  return (
    <div className="wrap">
      <Bar who={op} operator />
      <header className="masthead" style={{ padding: "2.5rem 0 1.75rem", marginBottom: "2rem" }}>
        <p className="eyebrow">Staff</p>
        <h1 style={{ fontSize: "2.25rem" }}>Operator</h1>
      </header>
      {low.length > 0 && (
        <p role="alert" className="notice err" style={{ marginBottom: "1.5rem" }}>
          Low on ETH for fees: {low.map((k) => `${k.label} (${Number(formatEther(k.balance)).toLocaleString("en-GB", { maximumFractionDigits: 6 })} ETH)`).join(", ")}.{" "}
          <Link href="/operator/keys">Top up under Keys</Link>.
        </p>
      )}
      <div className="console">
        <OperatorNav custodyRequests={custodyRequests} lowKeys={low.length} />
        <div className="console-main">{children}</div>
      </div>
    </div>
  );
}
