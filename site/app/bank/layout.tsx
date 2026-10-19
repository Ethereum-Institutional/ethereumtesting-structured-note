import { getStore } from "@/lib/store";
import { StaffShell } from "../staff/StaffShell";

export const dynamic = "force-dynamic";

/** The bank's portal: sign-ups, its clients' records, their onboarding for the deposit, and their admission to the conversion pool. */
export default async function BankLayout({ children }: { children: React.ReactNode }) {
  const store = getStore();
  const [registrants, admissions] = await Promise.all([store.listRegistrants(), store.listAdmissions(500)]);
  const pending = registrants.filter((r) => r.status === "pending").length;
  const waiting = admissions.filter((a) => a.status === "requested" && a.route !== "existing-identity").length;
  return (
    <StaffShell
      role="bank"
      items={[
        { href: "/bank", label: "Sign-ups", badge: pending },
        { href: "/bank/clients", label: "Clients" },
        { href: "/bank/onboarding", label: "Onboarding", badge: waiting },
        { href: "/bank/deposit", label: "Deposit" },
        { href: "/bank/pool", label: "Conversion pool" },
      ]}
    >
      {children}
    </StaffShell>
  );
}
