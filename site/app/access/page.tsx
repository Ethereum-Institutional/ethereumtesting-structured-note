import Link from "next/link";

export const dynamic = "force-dynamic";

/** Where an emailed sign-in link once led. Codes replace links (ADR 0093): a link sent before then does nothing. */
export default function Access() {
  return (
    <div className="wrap narrow">
      <header className="masthead">
        <p className="eyebrow">Structured Note Technical PoC</p>
        <h1 style={{ fontSize: "2.25rem" }}>Sign in with a code</h1>
      </header>
      <p>
        Sign-in links are no longer used. <Link href="/">Ask for a code</Link>: it is sent to your email address, and you type
        it into the page.
      </p>
    </div>
  );
}
