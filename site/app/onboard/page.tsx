import { redirect } from "next/navigation";
import { routeLabel } from "@/lib/routes";
import QRCode from "qrcode";
import { currentRegistrant } from "@/lib/access";
import type { Admission } from "@/lib/store";
import {
  bindWalletAction,
  advanceAdmissionAction,
  bindNewWalletAction,
  browserWalletFinishAction,
  browserWalletStartAction,
  cancelAdmissionAction,
  renewAdmissionAction,
  renewChallengeAction,
  requestSelfCustodyAction,
  startAdmissionAction,
  submitSignatureAction,
  unbindWalletAction,
  requestCustodyAction,
  withdrawCustodyRequestAction,
} from "../actions";
import { SignWallet } from "./SignWallet";
import { AutoRefresh } from "../AutoRefresh";
import { AnchorWatch } from "../AnchorWatch";
import { BrowserWallet } from "./BrowserWallet";
import { PendingButton } from "../PendingButton";
import { accountOf, walletOf } from "./account";
import { chainParams } from "@/lib/chains";
import { loadManifest } from "@/lib/chain/manifest";
import { CANCELLABLE } from "@/lib/admission/service";

export const dynamic = "force-dynamic";

/**
 * The client's account (ADRs 0054, 0076). Most clients are admitted by their bank or custodian and
 * never visit this page. Here a client can ask for its own wallet to be admitted under the KYB its
 * bank already holds, with one signature, or present credentials from a holder wallet; and once
 * onboarded, bind a new wallet, unbind it, or ask the bank to hold the account in custody instead.
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

/** The three stages every client route passes through, shown at the top of the page (ADR 0069). */
const STAGES = ["Complete bank onboarding", "Sign message from wallet", "Granted access"] as const;

function stageOf(status: Admission["status"] | undefined, onboarded: boolean): { at: number; done: boolean } {
  if (status === "admitted") return { at: 2, done: true };
  if (status === "ready" || status === "awaiting-anchor") return { at: 2, done: false };
  if (status === "kyb-confirmed" || status === "awaiting-signature" || status === "awaiting-wallet") return { at: 1, done: false };
  if (!status || ["cancelled", "offboarded", "failed", "declined", "refused"].includes(status)) return onboarded ? { at: 2, done: true } : { at: 0, done: false };
  return { at: 0, done: false };
}

function Progress({ at, done }: { at: number; done: boolean }) {
  return (
    <ol className="progress" aria-label="Onboarding progress">
      {STAGES.map((label, i) => {
        const state = i < at || (i === at && done) ? "done" : i === at ? "current" : "todo";
        return (
          <li key={label} className={state} aria-current={state === "current" ? "step" : undefined}>
            <span className="mark">{state === "done" ? "✓" : i + 1}</span>
            {label}
          </li>
        );
      })}
    </ol>
  );
}

const day = (iso: string) => iso.slice(0, 10);

export default async function Account() {
  const who = await currentRegistrant();
  if (!who) redirect("/");
  const acct = await accountOf(who);
  const { latest: a, open, wallet, held, kyb } = acct;
  const d = (a?.data ?? {}) as Record<string, any>;
  const chain = chainParams(loadManifest().chainId);
  const onboarded = Boolean(wallet || held);
  const returning = Boolean(kyb) || acct.viaHolder;
  const stage = stageOf(a?.status, onboarded);
  // A request is shown while it runs, and once it has ended badly; an ended one that worked is the account card.
  const showRequest = a && (open || !["admitted", "offboarded"].includes(a.status)) && !(a.status === "cancelled" && onboarded);

  return (
    <>
      {open && !["awaiting-signature", "kyb-confirmed", "awaiting-anchor"].includes(open.status) && <AutoRefresh />}
      {a?.status === "awaiting-anchor" && <AnchorWatch ids={[a.id]} advance={advanceAdmissionAction} />}
      <h2 id="account">Account</h2>
      {(!onboarded || open) && (
        <>
          <p className="lede" style={{ marginTop: 0 }}>
            If your bank or custodian holds your account, ask them to onboard it: there is nothing for you to do here.
            Otherwise your bank confirms the KYB it already holds, you sign once with your wallet, and the wallet is granted access.
          </p>
          <Progress {...stage} />
        </>
      )}

      {showRequest && (
        <section className="panel">
          <p><strong>{STATUS[a.status]}</strong> {a.status === "refused" && problems(d)} {a.status === "failed" && d.error}</p>
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
          {a.status === "awaiting-signature" && (
            <>
              {/* A failed or abandoned browser-wallet attempt can simply be run again. */}
              <BrowserWallet id={a.id} chain={chain} label="Connect MetaMask and bind this wallet" start={browserWalletStartAction} finish={browserWalletFinishAction} />
              <details style={{ marginTop: "1rem" }}>
                <summary className="muted">Or sign the message with another signer</summary>
                <div style={{ marginTop: "0.75rem" }}><SignStep a={a} d={d} /></div>
              </details>
            </>
          )}
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

      {wallet && (
        <section className="panel" aria-label="Your wallet">
          <p className="eyebrow">{wallet.route === "holder-wallet" ? "Holder wallet" : "Third-party wallet"}</p>
          <Facts a={wallet} />
          <div className="account-actions">
            {!open && (
              <form action={kyb ? bindNewWalletAction : startAdmissionAction}>
                <button type="submit">Bind a new wallet</button>
              </form>
            )}
            <CustodyRequest kyb={kyb} request={acct.custodyRequest} />
            <details>
              <summary>Unbind this wallet…</summary>
              <form action={unbindWalletAction} className="stack">
                <input type="hidden" name="id" value={wallet.id} />
                <p className="muted">
                  Revokes the wallet's pool grant and its Identity Registry grant at once. Whatever it holds stays in it,
                  but it can no longer convert, or receive or move the deposit or the note. Your KYB at the bank stands:
                  you can bind a wallet again with one signature.
                </p>
                <label style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
                  <input type="checkbox" required /> Unbind {walletOf(wallet)}
                </label>
                <div className="actions"><PendingButton className="quiet" working="Revoking both grants…">Unbind</PendingButton></div>
              </form>
            </details>
          </div>
          {kyb && <p className="muted" style={{ marginBottom: 0 }}>One wallet per KYB: once a new wallet or a custody account is onboarded, this wallet is unbound.</p>}
        </section>
      )}

      {held && (
        <section className="panel" aria-label="Held in custody">
          <p className="eyebrow">Held in custody by your bank</p>
          <Facts a={held} />
          <div className="account-actions">
            <p className="muted" style={{ margin: 0, flex: 1 }}>
              Your bank holds this account for you and acts in it on your instruction: crediting the deposit, converting, and
              accepting the notes it places with you.
            </p>
            {kyb && !open && !wallet && (
              <form action={bindNewWalletAction}>
                <button type="submit" className="quiet">Bind a wallet of your own instead</button>
              </form>
            )}
          </div>
        </section>
      )}

      {!onboarded && !open && returning && (
        <section className="panel">
          <h3 style={{ marginTop: 0 }}>No account onboarded</h3>
          <p className="muted">Your bank's confirmation of your KYB still stands: bind a wallet with one signature, or ask your bank to hold the account for you.</p>
          <div className="account-actions" style={{ borderTop: 0, paddingTop: 0 }}>
            <form action={kyb ? bindNewWalletAction : startAdmissionAction}>
              <button type="submit">Bind a wallet</button>
            </form>
            <CustodyRequest kyb={kyb} request={acct.custodyRequest} />
          </div>
        </section>
      )}

      {!onboarded && !open && !returning && (
        <div className="cols">
          <section className="panel">
            <h3 style={{ marginTop: 0 }}>A third-party wallet</h3>
            <p className="muted">
              A wallet you control: your own, or one another custodian holds for you. First your bank confirms the KYB
              it already holds for you; then you bind the wallet with one signature.
            </p>
            <div className="actions">
              <form action={requestSelfCustodyAction}>
                <button type="submit">Ask my bank to confirm my KYB</button>
              </form>
              <button type="button" disabled title="Available once your bank confirms your KYB">Bind wallet</button>
            </div>
          </section>
          <section className="panel">
            <h3 style={{ marginTop: 0 }}>Credentials in a holder wallet</h3>
            <p className="muted">For clients who carry their credentials: scan with the holder wallet.</p>
            <form action={startAdmissionAction}>
              <button type="submit" className="quiet">Present from a holder wallet</button>
            </form>
          </section>
        </div>
      )}

      {acct.earlier.length > 0 && (
        <details className="panel">
          <summary>Earlier wallets ({acct.earlier.length})</summary>
          <div className="table-wrap" style={{ marginTop: "0.75rem" }}>
            <table>
              <thead><tr><th>Wallet</th><th>Route</th><th>Onboarded</th><th>Ended</th><th>Why</th></tr></thead>
              <tbody>
                {acct.earlier.map((x) => {
                  const o = (x.data as Record<string, any>).offboarded;
                  return (
                    <tr key={x.id}>
                      <td>{walletOf(x)}</td>
                      <td>{routeLabel(x.route)}</td>
                      <td>{day(x.createdAt)}</td>
                      <td>{o?.at ? day(o.at) : ""}</td>
                      <td>{o?.reason ?? ""}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </details>
      )}
    </>
  );
}

/** An onboarded account's facts: its address, when, how long its grant runs, and whether it may take the notes. */
function Facts({ a }: { a: Admission }) {
  const d = a.data as Record<string, any>;
  const to = d.written?.poolGrantExpiresAt;
  return (
    <dl className="facts">
      <dt>Address</dt><dd><code>{walletOf(a)}</code></dd>
      <dt>Onboarded</dt><dd>{day(a.createdAt)}</dd>
      <dt>Grant runs to</dt><dd>{to ? new Date(to * 1000).toISOString().slice(0, 10) : ""}</dd>
      <dt>Notes</dt>
      <dd>{d.regS ? `Approved under Regulation S on ${day(d.regS.at)}` : "Not yet approved: your bank approves you for its notes before offering them."}</dd>
    </dl>
  );
}

/** Asking the bank to hold the account in custody (ADR 0076), or the request already made. */
function CustodyRequest({ kyb, request }: { kyb: string | null; request?: { at: string } }) {
  if (!kyb) return null;
  if (request) {
    return (
      <form action={withdrawCustodyRequestAction} className="actions">
        <span className="muted">You asked your bank to hold your account in custody on {day(request.at)}.</span>
        <button type="submit" className="quiet">Withdraw the request</button>
      </form>
    );
  }
  return (
    <form action={requestCustodyAction}>
      <button type="submit" className="quiet">Ask my bank to hold it in custody</button>
    </form>
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
