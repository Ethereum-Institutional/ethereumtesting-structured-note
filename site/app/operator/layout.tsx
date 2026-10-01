import { notFound } from "next/navigation";
import { currentOperator } from "@/lib/access";
import { getStore } from "@/lib/store";
import { Bar } from "../Bar";
import { OperatorNav } from "./OperatorNav";

export const dynamic = "force-dynamic";

/** Every Operator page: staff only, with the navigation column beside it (ADR 0073). */
export default async function OperatorLayout({ children }: { children: React.ReactNode }) {
  const op = await currentOperator();
  if (!op) notFound();
  const custodyRequests = (await getStore().listClients()).filter((c) => c.custodyRequest).length;
  return (
    <div className="wrap">
      <Bar who={op} operator />
      <header className="masthead" style={{ padding: "2.5rem 0 1.75rem", marginBottom: "2rem" }}>
        <p className="eyebrow">Staff</p>
        <h1 style={{ fontSize: "2.25rem" }}>Operator</h1>
      </header>
      <div className="console">
        <OperatorNav custodyRequests={custodyRequests} />
        <div className="console-main">{children}</div>
      </div>
    </div>
  );
}
