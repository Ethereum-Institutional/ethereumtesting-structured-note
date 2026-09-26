import { redirect } from "next/navigation";
import QRCode from "qrcode";
import { currentRegistrant, isOperator } from "@/lib/access";
import { getStore, type Admission } from "@/lib/store";
import { Bar } from "../Bar";
import { renewAdmissionAction, startAdmissionAction } from "../actions";

export const dynamic = "force-dynamic";

/**
 * Admission to the conversion pool, as the participant's officer sees it (ADRs 0045, 0046): two
 * QR codes, scanned in turn with the holder wallet, then an operator's decision.
 */

const STEPS: Record<Admission["status"], string> = {
  "awaiting-officer": "Step 1 of 2: present your officer credential",
  "awaiting-wallet": "Step 2 of 2: present the wallet-control credential for the wallet to admit",
  ready: "Received. Awaiting the Access Issuer's approval.",
  refused: "Not admitted",
  admitted: "Admitted to the conversion pool",
  declined: "Declined by the Access Issuer",
  failed: "The grants could not be written",
};

export default async function Admit() {
  const who = await currentRegistrant();
  if (!who) redirect("/");
  const a = await getStore().latestAdmissionFor(who.id);
  const d = (a?.data ?? {}) as Record<string, any>;
  const waiting = a?.status === "awaiting-officer" || a?.status === "awaiting-wallet";
  const request = a?.status === "awaiting-officer" ? d.officerRequest : d.walletRequest;
  const url: string | undefined = a?.status === "awaiting-officer" ? d.officerUrl : d.walletUrl;
  const expired = waiting && request && request.expiresAt < Math.floor(Date.now() / 1000);
  const qr = waiting && url && !expired ? await QRCode.toString(url, { type: "svg", margin: 1, errorCorrectionLevel: "M" }) : null;

  return (
    <div className="wrap">
      {waiting && !expired && <meta httpEquiv="refresh" content="4" />}
      <Bar who={who} operator={isOperator(who.email)} />
      <header className="masthead" style={{ paddingBottom: "1rem" }}>
        <p className="eyebrow">Conversion pool</p>
        <h1 style={{ fontSize: "2.25rem" }}>Admission</h1>
        <p className="lede">
          An officer of the institution presents from their own wallet: first their officer credential, then the
          wallet-control credential for the wallet to admit. Both must be issued by the configured issuer.
        </p>
      </header>
      {!a || a.status === "refused" || a.status === "declined" || a.status === "admitted" || a.status === "failed" ? (
        <section className="panel">
          {a && <p><strong>{STEPS[a.status]}.</strong> {a.status === "refused" && refusal(d)}</p>}
          {a?.status === "admitted" && <p className="muted">{d.assessment?.summary?.wallet} may now convert in the pool.</p>}
          <form action={startAdmissionAction}>
            <button type="submit">{a ? "Start a new admission" : "Start admission"}</button>
          </form>
        </section>
      ) : (
        <section className="panel">
          <p><strong>{STEPS[a.status]}</strong></p>
          {qr ? (
            <>
              <div style={{ maxWidth: 280, background: "#fff", padding: 8 }} dangerouslySetInnerHTML={{ __html: qr }} />
              <p className="muted">Scan with the holder wallet. The code is valid for five minutes.</p>
            </>
          ) : waiting ? (
            <form action={renewAdmissionAction}>
              <input type="hidden" name="id" value={a.id} />
              <p className="muted">The code has expired.</p>
              <button type="submit">Show a new code</button>
            </form>
          ) : null}
        </section>
      )}
    </div>
  );
}

function refusal(d: Record<string, any>): string {
  if (d.assessment && !d.assessment.ok) return d.assessment.problems.join(" ");
  return d.error ?? "";
}
