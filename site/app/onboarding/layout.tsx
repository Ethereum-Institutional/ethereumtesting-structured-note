import { getStore } from "@/lib/store";
import { dataOf } from "@/lib/identity/onboarding";
import { StaffShell } from "../staff/StaffShell";

export const dynamic = "force-dynamic";

/** The onboarding agent's portal: requests for the notes, its claims, identities brought from elsewhere. */
export default async function OnboardingLayout({ children }: { children: React.ReactNode }) {
  const admissions = await getStore().listAdmissions(500);
  const requests = admissions.filter((a) => a.status === "onboarded" && dataOf(a).note?.status === "requested").length;
  const existing = admissions.filter((a) => a.route === "existing-identity" && a.status === "requested").length;
  return (
    <StaffShell
      role="onboarding"
      items={[
        { href: "/onboarding", label: "Requests for the notes", badge: requests },
        { href: "/onboarding/existing", label: "Existing identities", badge: existing },
        { href: "/onboarding/participants", label: "Vouched for" },
      ]}
    >
      {children}
    </StaffShell>
  );
}
