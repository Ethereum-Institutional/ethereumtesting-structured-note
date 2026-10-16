import Link from "next/link";
import { signOutAction } from "./actions";
import type { Registrant } from "@/lib/store";
import { rolesOf } from "@/lib/operators";
import { BarMenu } from "./BarMenu";

/** The portals a staff member may open, in the bar's order (ADR 0089). */
export const PORTALS = [
  { role: "bank", href: "/bank", label: "Bank" },
  { role: "onboarding", href: "/onboarding", label: "Onboarding agent" },
  { role: "custodian", href: "/custodian", label: "Custodians" },
  { role: "agent", href: "/agent", label: "Agent" },
] as const;

export function Bar({ who }: { who: Registrant; operator?: boolean }) {
  const roles = rolesOf(who.email);
  return (
    <div className="bar">
      <span>Structured Note Technical PoC</span>
      <BarMenu>
        <Link href="/">Architecture</Link>
        <a href="/overview">Solution overview</a>
        <Link href="/onboard">Onboard</Link>
        <Link href="/ledger">Ledger</Link>
        {PORTALS.filter((p) => roles.includes(p.role)).map((p) => (
          <Link key={p.href} href={p.href}>{p.label}</Link>
        ))}
        <span>{who.email}</span>
        <form action={signOutAction}>
          <button type="submit" className="quiet">Sign out</button>
        </form>
      </BarMenu>
    </div>
  );
}
