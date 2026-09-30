import { redirect } from "next/navigation";
import QRCode from "qrcode";
import { currentRegistrant, isOperator } from "@/lib/access";
import { getStore, type Admission } from "@/lib/store";
import { Bar } from "../Bar";
import {
  bindWalletAction,
  advanceAdmissionAction,
  browserWalletFinishAction,
  browserWalletStartAction,
  cancelAdmissionAction,
  renewAdmissionAction,
  renewChallengeAction,
  requestSelfCustodyAction,
  startAdmissionAction,
  submitSignatureAction,
} from "../actions";
import { SignWallet } from "./SignWallet";
import { AutoRefresh } from "../AutoRefresh";
import { AnchorWatch } from "../AnchorWatch";
import { BrowserWallet } from "./BrowserWallet";
import { chainParams } from "@/lib/chains";
import { loadManifest } from "@/lib/chain/manifest";
import { CANCELLABLE } from "@/lib/admission/service";

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
  "awaiting-wallet": "Step 2 of 2: your officer credential is verified. Now bind the wallet to onboard.",
  ready: "Received. Awaiting the bank's approval.",
  "awaiting-anchor": "Almost there: waiting for your bank to anchor the credential on-chain, usually about a minute. This page updates by itself.",
  refused: "Not admitted.",
  admitted: "Admitted to the conversion pool.",
  declined: "Declined by the bank.",
  cancelled: "You cancelled this request. Choose a way to be admitted below.",
  offboarded: "Your bank has offboarded this wallet from the pool.",
  failed: "The admission could not be completed.",
};

/** The routes a client takes itself. A custodied admission is the bank's own act and is shown to staff (ADR 0062). */
const CLIENT_ROUTES = ["self-custody", "holder-wallet"] as const;

export default async function Onboard() {
  const who = await currentRegistrant();
  if (!who) redirect("/");
  const store = getStore();
  const [a, mine] = await Promise.all([store.latestAdmissionFor(who.id, [...CLIENT_ROUTES]), store.admissionsFor(who.id)]);
  const onboarded = mine.filter((x) => x.status === "admitted" && (CLIENT_ROUTES as readonly string[]).includes(x.route));
  const d = (a?.data ?? {}) as Record<string, any>;
  const chain = chainParams(loadManifest().chainId);
  const open = a && !["refused", "admitted", "declined", "cancelled", "offboarded", "failed"].includes(a.status);

  return (
    <div className="wrap">
      {open && a.status !== "awaiting-signature" && a.status !== "kyb-confirmed" && a.status !== "awaiting-anchor" && <AutoRefresh />}
      {a?.status === "awaiting-anchor" && <AnchorWatch ids={[a.id]} advance={advanceAdmissionAction} />}
      <Bar who={who} operator={isOperator(who.email)} />
      <header className="masthead" style={{ paddingBottom: "1rem" }}>
        <p className="eyebrow">Conversion pool</p>
        <h1 style={{ fontSize: "2.25rem" }}>Onboard</h1>
        <p className="lede">
          If your bank or custodian holds your account, ask them to onboard it: there is nothing for you to do here.
          Already onboarded by your bank? You can add a wallet you hold yourself at any time, by either route below.
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
          {a.status === "awaiting-bank-review" && <BindStep a={a} />}
          {a.status === "kyb-confirmed" && (
            <>
              <BrowserWallet id={a.id} chain={chain} label="Connect MetaMask and bind this wallet" start={browserWalletStartAction} finish={browserWalletFinishAction} />
              <details style={{ marginTop: "1rem" }}>
                <summary className="muted">Another signer, or a contract wallet</summary>
                <div style={{ marginTop: "0.75rem" }}><BindStep a={a} /></div>
              </details>
            </>
          )}
          {a.status === "awaiting-signature" && <SignStep a={a} d={d} />}
          {a.status === "awaiting-officer" && <QrStep a={a} d={d} />}
          {a.status === "awaiting-wallet" && (
            <>
              <BrowserWallet id={a.id} chain={chain} label="Connect MetaMask and bind the officer's wallet" start={browserWalletStartAction} finish={browserWalletFinishAction} />
              <details style={{ marginTop: "1rem" }}>
                <summary className="muted">Or present a wallet-control credential from the holder wallet</summary>
                <div style={{ marginTop: "0.75rem" }}><QrStep a={a} d={d} /></div>
              </details>
            </>
          )}
          {CANCELLABLE.includes(a.status) && (
            <form action={cancelAdmissionAction} className="actions" style={{ marginTop: "1.25rem" }}>
              <input type="hidden" name="id" value={a.id} />
              <button type="submit" className="quiet">
                {a.route === "holder-wallet" ? "Cancel and choose another way" : "Cancel this request"}
              </button>
            </form>
          )}
        </section>
      )}

      {onboarded.length > 0 && (
        <section className="panel">
          <h2>Your onboarded wallets</h2>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Wallet</th><th>Route</th><th>Onboarded</th><th>Grant runs to</th></tr></thead>
              <tbody>
                {onboarded.map((x) => {
                  const xd = x.data as Record<string, any>;
                  const to = xd.written?.poolGrantExpiresAt;
                  return (
                    <tr key={x.id}>
                      <td>{xd.assessment?.summary?.wallet}</td>
                      <td>{x.route === "self-custody" ? "Wallet you hold" : "Holder wallet"}</td>
                      <td>{x.createdAt.slice(0, 10)}</td>
                      <td>{to ? new Date(to * 1000).toISOString().slice(0, 10) : ""}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
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
