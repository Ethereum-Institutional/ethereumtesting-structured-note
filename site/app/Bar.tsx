import Link from "next/link";
import { signOutAction } from "./actions";
import type { Registrant } from "@/lib/store";

export function Bar({ who, operator }: { who: Registrant; operator: boolean }) {
  return (
    <div className="bar">
      <span>Structured Note Technical PoC</span>
      <nav>
        <Link href="/">Architecture</Link>
        <a href="/overview">Solution overview</a>
        {operator && <Link href="/operator">Access requests</Link>}
        <span>{who.email}</span>
        <form action={signOutAction}>
          <button type="submit" className="quiet">Sign out</button>
        </form>
      </nav>
    </div>
  );
}
