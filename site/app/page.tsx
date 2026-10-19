import { currentRegistrant, isOperator } from "@/lib/access";
import { Architecture } from "./Architecture";
import { Bar } from "./Bar";
import { RegisterForm, SignInForm } from "./Forms";

export const dynamic = "force-dynamic";

export default async function Home() {
  const who = await currentRegistrant();
  if (!who) return <Landing />;
  return (
    <div className="wrap">
      <Bar who={who} operator={isOperator(who.email)} />
      <header className="masthead" style={{ paddingBottom: "0.5rem" }}>
        <p className="eyebrow">System architecture</p>
        <h1>Structured Note Smart Contract Issuance</h1>
        <p className="lede">
          An instruction originates in institution systems, crosses an integration layer, and settles on the shared
          ledger.
        </p>
      </header>
      <Architecture />
      <h2>Documents</h2>
      <ul className="docs">
        <li>
          <a href="/overview">
            <strong>Solution overview</strong>
            <span>Roles, instrument, lifecycle, identity, controls, standards, programme and test scenarios</span>
          </a>
        </li>
      </ul>
      <footer>Test network only. No securities are offered or sold, and no client assets or client data are involved.</footer>
    </div>
  );
}

function Landing() {
  return (
    <div className="wrap">
      <header className="masthead">
        <p className="eyebrow">Technical proof of concept</p>
        <h1>Structured Note Technical PoC</h1>
        <p className="lede">Access is by registration and approval.</p>
      </header>
      <div className="cols">
        <section className="panel">
          <h2>Register</h2>
          <p className="muted">
            Confirm your email address with the six-digit code sent to it. Access is granted once your registration has
            been approved.
          </p>
          <RegisterForm />
        </section>
        <section className="panel">
          <h2>Already registered</h2>
          <p className="muted">A one-time six-digit code is sent to the address you registered.</p>
          <SignInForm />
        </section>
      </div>
      <footer>
        Your name, organisation and email address are used only to administer access to this site.
      </footer>
    </div>
  );
}
