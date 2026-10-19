import Link from "next/link";
import { normaliseEmail, validEmail } from "@/lib/access";
import { CodeForm } from "../Forms";

export const dynamic = "force-dynamic";

/**
 * Where the code mail links: the code box for the address in the link, so the code can be
 * typed in a new tab or later. The link carries no code, and the page says nothing about whether the
 * address is registered: a code typed for an unknown address is refused like a wrong one.
 */
export default async function Access({ searchParams }: { searchParams: Promise<{ email?: string | string[] }> }) {
  const raw = (await searchParams).email;
  const email = typeof raw === "string" ? normaliseEmail(raw) : "";
  return (
    <div className="wrap narrow">
      <header className="masthead">
        <p className="eyebrow">Structured Note Technical PoC</p>
        <h1 style={{ fontSize: "2.25rem" }}>Sign in with a code</h1>
      </header>
      {validEmail(email) ? (
        <section className="panel">
          <CodeForm email={email} notice={`Type the six-digit code from the email sent to ${email}. It is valid for 10 minutes and can be used once.`} />
          <p>
            <Link href="/">Ask for a new code</Link>
          </p>
        </section>
      ) : (
        <p>
          <Link href="/">Ask for a code</Link>: it is sent to your email address, with a link back to this page.
        </p>
      )}
    </div>
  );
}
