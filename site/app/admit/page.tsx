import { redirect } from "next/navigation";
import QRCode from "qrcode";
import { currentRegistrant, isOperator } from "@/lib/access";
import { getStore, type Admission } from "@/lib/store";
import { Bar } from "../Bar";
import {
  bindWalletAction,
  renewAdmissionAction,
  renewChallengeAction,
  requestSelfCustodyAction,
  startAdmissionAction,
  submitSignatureAction,
} from "../actions";
import { SignWallet } from "./SignWallet";
import { AutoRefresh } from "../AutoRefresh";

export const dynamic = "force-dynamic";

/**
 * Admission to the conversion pool, as the client sees it (ADR 0054). Most clients are admitted by
 * their bank or custodian and never visit this page. Here a client can ask for its own wallet to
 * be admitted under the KYB its bank already holds, with one signature; or present credentials from
 * a holder wallet.
 */

const STATUS: Record<Admission["status"], string> = {
  "awaiting-bank-review": "Step 1 of 2: your bank is confirming your KYB.",
  "kyb-confirmed": "Step 2 of 2: your bank has confirmed your KYB. Bind the wallet to admit.",
  "awaiting-signature": "Step 2 of 2: sign once with the wallet to bind it.",
  "awaiting-officer": "Step 1 of 2: present your officer credential.",
  "awaiting-wallet": "Step 2 of 2: present the wallet-control credential.",
  ready: "Received. Awaiting the bank's approval.",
  refused: "Not admitted.",
  admitted: "Admitted to the conversion pool.",
  declined: "Declined by the bank.",
  failed: "The admission could not be completed.",
};

export default async function Admit() {
  const who = await currentRegistrant();
  if (!who) redirect("/");
  const a = await getStore().latestAdmissionFor(who.id);
  const d = (a?.data ?? {}) as Record<string, any>;
  const open = a && !["refused", "admitted", "declined", "failed"].includes(a.status);

  return (
    <div className="wrap">
      {open && a.status !== "awaiting-signature" && a.status !== "kyb-confirmed" && <AutoRefresh />}
      <Bar who={who} operator={isOperator(who.email)} />
      <header className="masthead" style={{ paddingBottom: "1rem" }}>
        <p className="eyebrow">Conversion pool</p>
        <h1 style={{ fontSize: "2.25rem" }}>Admission</h1>
        <p className="lede">
          If your bank or custodian holds your account, ask them to admit it: there is nothing for you to do here.
          To admit a wallet you hold yourself, your bank reuses the verification it already holds, and you sign once.
        </p>
      </header>

      {a && (
        <section className="panel">
          <p><strong>{STATUS[a.status]}</strong> {a.status === "refused" && problems(d)} {a.status === "failed" && d.error}</p>
          {a.status === "admitted" && <p className="muted">{d.assessment?.summary?.wallet} may now convert in the pool.</p>}
          {d.record?.kycReference && a.route === "self-custody" && (
            <p className="muted">Your bank's reference for you: {d.record.kycReference}{d.record.legalName ? `, ${d.record.legalName}` : ""}.</p>
          )}
          {a.status === "kyb-confirmed" && d.error && <p role="alert">The last attempt to bind a wallet failed: {d.error}</p>}
          {(a.status === "awaiting-bank-review" || a.status === "kyb-confirmed") && <BindStep a={a} />}
          {a.status === "awaiting-signature" && <SignStep a={a} d={d} />}
          {(a.status === "awaiting-officer" || a.status === "awaiting-wallet") && <QrStep a={a} d={d} />}
        </section>
      )}

      {!open && (
        <div className="cols">
          <section className="panel">
            <h2>A wallet you hold</h2>
            <p className="muted">
              Your own wallet, or one a third party holds for you. First your bank confirms the KYB it already holds
              for you; then you bind the wallet with one signature.
            </p>
            <div className="actions">
              <form action={requestSelfCustodyAction}>
                <button type="submit">Ask my bank to confirm my KYB</button>
              </form>
              <button type="button" disabled title="Available once your bank confirms your KYB">Bind wallet</button>
            </div>
          </section>
          <section className="panel">
            <h2>Credentials in a holder wallet</h2>
            <p className="muted">For clients who carry their credentials: scan with the holder wallet.</p>
            <form action={startAdmissionAction}>
              <button type="submit" className="quiet">Present from a holder wallet</button>
            </form>
          </section>
        </div>
      )}
    </div>
  );
}

/** Binding a wallet: shown throughout step 1, usable once the bank has confirmed the KYB. */
function BindStep({ a }: { a: Admission }) {
  const ready = a.status === "kyb-confirmed";
  return (
    <form action={bindWalletAction} className="stack">
      <input type="hidden" name="id" value={a.id} />
      <fieldset disabled={!ready} className="stack" style={{ border: 0, padding: 0, margin: 0 }}>
        <label>Wallet address<input name="walletAddress" required pattern="0x[0-9a-fA-F]{40}" /></label>
        <label>
          Wallet type
          <select name="addressType" defaultValue="eoa">
            <option value="eoa">Ordinary wallet (a key)</option>
            <option value="smart_contract">Contract wallet on this network</option>
          </select>
        </label>
        <button type="submit">Bind wallet</button>
      </fieldset>
      {!ready && <p className="muted">Binding a wallet opens once your bank has confirmed your KYB. This page updates by itself.</p>}
    </form>
  );
}

function SignStep({ a, d }: { a: Admission; d: Record<string, any> }) {
  const expired = d.challenge?.expiresAt && d.challenge.expiresAt < Math.floor(Date.now() / 1000);
  if (expired) {
    return (
      <form action={renewChallengeAction}>
        <input type="hidden" name="id" value={a.id} />
        <p className="muted">The message to sign has expired.</p>
        <button type="submit">Get a new one</button>
      </form>
    );
  }
  return <SignWallet id={a.id} address={d.request.walletAddress} typedData={d.challenge.typedData} action={submitSignatureAction} />;
}

async function QrStep({ a, d }: { a: Admission; d: Record<string, any> }) {
  const request = a.status === "awaiting-officer" ? d.officerRequest : d.walletRequest;
  const url: string | undefined = a.status === "awaiting-officer" ? d.officerUrl : d.walletUrl;
  if (!request || !url || request.expiresAt < Math.floor(Date.now() / 1000)) {
    return (
      <form action={renewAdmissionAction}>
        <input type="hidden" name="id" value={a.id} />
        <p className="muted">The code has expired.</p>
        <button type="submit">Show a new code</button>
      </form>
    );
  }
  const qr = await QRCode.toString(url, { type: "svg", margin: 1, errorCorrectionLevel: "M" });
  return (
    <>
      <div style={{ maxWidth: 280, background: "#fff", padding: 8 }} dangerouslySetInnerHTML={{ __html: qr }} />
      <p className="muted">Scan with the holder wallet. The code is valid for five minutes.</p>
    </>
  );
}

function problems(d: Record<string, any>): string {
  if (d.assessment && !d.assessment.ok) return d.assessment.problems.join(" ");
  return d.error ?? "";
}
