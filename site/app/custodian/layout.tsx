import { getStore } from "@/lib/store";
import { StaffShell } from "../staff/StaffShell";

export const dynamic = "force-dynamic";

/** The custodians' portal: the bank's custody platform and a third-party custodian. */
export default async function CustodianLayout({ children }: { children: React.ReactNode }) {
  const waiting = (await getStore().listAdmissions(500)).filter((a) => a.status === "awaiting-custodian" && a.route === "third-party").length;
  return (
    <StaffShell role="custodian" items={[{ href: "/custodian", label: "Accounts", badge: waiting }]}>
      {children}
    </StaffShell>
  );
}
