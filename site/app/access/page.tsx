import Link from "next/link";
import { linkUsable } from "@/lib/access";
import { confirmAction } from "../actions";

export const dynamic = "force-dynamic";

/**
 * Landing point of an emailed link. Opening it changes nothing: mail scanners fetch links in
 * advance, so the token is consumed only when the visitor submits the form below.
 */
export default async function Access({ searchParams }: { searchParams: Promise<{ token?: string; invalid?: string }> }) {
  const { token = "", invalid } = await searchParams;
  // A store failure reads as an unusable link, not an error page.
  const usable = !invalid && (await linkUsable(token).catch(() => false));
  return (
    <div className="wrap narrow">
      <header className="masthead">
        <p className="eyebrow">Structured Note Technical PoC</p>
        <h1 style={{ fontSize: "2.25rem" }}>{usable ? "Continue" : "Link not valid"}</h1>
      </header>
      {usable ? (
        <form action={confirmAction} className="stack">
          <input type="hidden" name="token" value={token} />
          <p>Continue to confirm your email address and sign in.</p>
          <button type="submit">Continue</button>
        </form>
      ) : (
        <p>
          This link has expired or has already been used. <Link href="/">Request a new one</Link>.
        </p>
      )}
    </div>
  );
}
