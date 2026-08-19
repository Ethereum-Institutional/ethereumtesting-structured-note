import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { Panel } from "@/components/ui";
import { LoginForm } from "@/components/LoginForm";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  const user = await currentUser();
  if (user) redirect(user.role === "admin" ? "/portal/admin" : "/account");

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center p-5">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Meridian Custody</h1>
        <p className="mt-1.5 text-sm" style={{ color: "var(--muted)" }}>
          Investor portal for the APAC Diversified Credit Fund
        </p>
      </header>

      <Panel title="Sign in" subtitle="No password — we send you a one-time link">
        <LoginForm />
      </Panel>

      <div className="mt-5 space-y-2 text-[11px] leading-relaxed" style={{ color: "var(--muted)" }}>
        <p>
          <strong style={{ color: "var(--warn)" }}>Demonstration system.</strong> Signing up creates
          an account pre-filled with invented personal and financial details — never enter your own.
          Your email address is used only to create a session, and the fund, the money and the
          holdings are all fictional.
        </p>
        <p>
          Built on ERC-3643 (T-REX) by Tokeny and Uniswap v4 permissioned pools, joined by
          OpenZeppelin&apos;s compliance layer.
        </p>
        <p>
          <Link href="/build" style={{ color: "var(--accent)" }}>
            How this was built
          </Link>
          {" · "}
          <Link href="/" style={{ color: "var(--accent)" }}>
            Custody console
          </Link>
        </p>
      </div>
    </main>
  );
}
