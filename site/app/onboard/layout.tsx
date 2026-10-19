import { redirect } from "next/navigation";
import { currentRegistrant, isOperator } from "@/lib/access";
import { Bar } from "../Bar";
import { ConsoleNav } from "../ConsoleNav";

export const dynamic = "force-dynamic";

/** The client's pages: its account, converting, and the notes offered to it, beside a navigation column. */
export default async function OnboardLayout({ children }: { children: React.ReactNode }) {
  const who = await currentRegistrant();
  if (!who) redirect("/");
  const offers = await (await import("@/lib/notes/place")).offersFor(who).catch(() => null);
  const waiting = offers ? offers.toMe.length + offers.arranged.length : 0;
  return (
    <div className="wrap">
      <Bar who={who} operator={isOperator(who.email)} />
      <header className="masthead" style={{ padding: "2.5rem 0 1.75rem", marginBottom: "2rem" }}>
        <p className="eyebrow">Client</p>
        <h1 style={{ fontSize: "2.25rem" }}>Onboard</h1>
      </header>
      <div className="console">
        <ConsoleNav
          label="Onboard"
          items={[
            { href: "/onboard", label: "Account" },
            { href: "/onboard/convert", label: "Convert" },
            { href: "/onboard/notes", label: "Notes", badge: waiting },
          ]}
        />
        <div className="console-main">{children}</div>
      </div>
    </div>
  );
}
