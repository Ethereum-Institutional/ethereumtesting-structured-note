import { redirect } from "next/navigation";
import { currentRegistrant } from "@/lib/access";
import type { Admission } from "@/lib/store";
import { routeLabel } from "@/lib/routes";
import { chainParams } from "@/lib/chains";
import { loadManifest } from "@/lib/chain/manifest";
import { claimState } from "@/lib/identity/participants";
import { CANCELLABLE, dataOf } from "@/lib/identity/onboarding";
import {
  bringIdentityAction,
  browserWalletFinishAction,
  browserWalletStartAction,
  cancelOnboardingAction,
  requestNoteAction,
  requestRouteAction,
} from "../actions";
import { AutoRefresh } from "../AutoRefresh";
import { BrowserWallet } from "./BrowserWallet";
import { PendingButton } from "../PendingButton";
import { BringIdentityForm, NoteRequestForm } from "./Forms";
import { accountOf } from "./account";
import { Address } from "../Address";
import { ActionForm } from "../staff/ActionForm";
import { requestCloseAction, withdrawCloseAction } from "../actions";

export const dynamic = "force-dynamic";

/**
 * The client's account (ADR 0089): onboarded for the deposit first, by the route it chooses, then
 * access to the note. Its bank confirms its KYB, the wallet or account gets an identity, the bank
 * vouches for it, and the onboarding agent vouches for the note once asked.
 */

const ROUTES = [
  {
    route: "bank-custody",
    title: "Bank custody",
    body: "Your bank's custody platform holds a segregated account for you, and signs for it. You sign nothing.",
  },
  {
    route: "third-party",
    title: "A third-party custodian",
    body: "Your own custodian opens a segregated account for you, once your bank has confirmed your KYB.",
  },
  {
    route: "self-custody",
    title: "Self-custody",
    body: "Your own wallet. You sign once, pay no fee, and hold your identity's key yourself afterwards.",
  },
] as const;

const STAGES: Record<Admission["route"], string[]> = {
  "bank-custody": ["Your bank confirms your KYB", "The custody platform opens your account", "Onboarded for the deposit"],
  "third-party": ["Your bank confirms your KYB", "Your custodian opens your account", "Onboarded for the deposit"],
  "self-custody": ["Your bank confirms your KYB", "Sign once from your wallet", "Onboarded for the deposit"],
  "existing-identity": ["Sign once from your wallet", "The onboarding agent registers it", "Registered for the note"],
};

function stageOf(a: Admission): number {
  if (a.route === "existing-identity") return a.status === "awaiting-wallet" ? 0 : a.status === "requested" ? 1 : 2;
  return a.status === "requested" ? 0 : ["awaiting-wallet", "awaiting-custodian"].includes(a.status) ? 1 : 2;
}

function Progress({ a }: { a: Admission }) {
  const at = stageOf(a);
  return (
    <ol className="progress" aria-label="Onboarding progress">
      {STAGES[a.route].map((label, i) => {
        const state = i < at ? "done" : i === at ? "current" : "todo";
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

export default async function Account() {
  const who = await currentRegistrant();
  if (!who) redirect("/");
  const { open, onboarded, ended } = await accountOf(who);
  const chain = chainParams(loadManifest().chainId);
  const waitingOnOthers = open.some((a) => a.status === "requested" || a.status === "awaiting-custodian") || onboarded.some((p) => dataOf(p.admission).note?.status === "requested");

  return (
    <>
      {waitingOnOthers && <AutoRefresh />}
      <h2 id="account">Account</h2>

      {onboarded.map((p) => {
        const d = dataOf(p.admission);
        const deposit = claimState(p.claims.deposit);
        const note = claimState(p.claims.note);
        return (
          <section className="panel" key={p.admission.id} aria-label={routeLabel(p.admission.route)}>
            <p className="eyebrow">{routeLabel(p.admission.route)}</p>
            <dl className="facts">
              <dt>{p.admission.route === "self-custody" || p.admission.route === "existing-identity" ? "Your wallet" : "Your account"}</dt><dd><Address value={p.wallet} /></dd>
              <dt>Your identity</dt><dd><Address value={p.identity} />{p.admission.route === "self-custody" && <span className="muted"> (managed by your wallet)</span>}</dd>
              <dt>The deposit</dt><dd><span className={`pill ${deposit.pill}`}>{p.eligible.deposit ? `eligible, ${deposit.label}` : `not eligible (${deposit.label})`}</span></dd>
              <dt>The note</dt>
              <dd>
                <span className={`pill ${note.pill}`}>{p.eligible.note ? `eligible, ${note.label}` : d.note?.status === "requested" ? "asked; the onboarding agent decides" : d.note?.status === "declined" ? "declined" : d.note?.status === "revoked" ? "revoked" : "not asked"}</span>
              </dd>
              {p.pool && (
                <>
                  <dt>The conversion pool</dt>
                  <dd><span className={`pill ${p.pool === "admitted" ? "approved" : "pending"}`}>{p.pool === "admitted" ? `admitted, ${claimState(p.claims.pool).label}` : p.pool}</span></dd>
                </>
              )}
            </dl>
            {p.admission.route !== "existing-identity" && (!d.note || d.note.status === "declined") && p.eligible.deposit && !d.closeRequest && (
              <details>
                <summary>Ask for access to the note…</summary>
                <NoteRequestForm id={p.admission.id} action={requestNoteAction} />
              </details>
            )}
            {d.closeRequest ? (
              <div className="notice">
                <p style={{ margin: 0 }}>You asked to close this account on {d.closeRequest.at.slice(0, 10)}: {d.closeRequest.reason}. The bank closes it.</p>
                <ActionForm action={withdrawCloseAction} hidden={{ id: p.admission.id }} label="Withdraw the request" working="Withdrawing…" quiet />
              </div>
            ) : (
              <details>
                <summary>Close this account…</summary>
                <ActionForm action={requestCloseAction} hidden={{ id: p.admission.id }} label="Ask to close" working="Checking what the account holds…" quiet>
                  <p className="muted" style={{ margin: 0 }}>
                    The bank revokes its claim and removes the {p.admission.route === "self-custody" || p.admission.route === "existing-identity" ? "wallet" : "account"} from every
                    registry: it can then neither hold nor receive the deposit or the note. It must first hold nothing and be owed nothing. The bank keeps its records.
                  </p>
                  <label>Reason<input name="reason" required maxLength={500} /></label>
                </ActionForm>
              </details>
            )}
          </section>
        );
      })}

      {open.map((a) => {
        const d = dataOf(a);
        return (
          <section className="panel" key={a.id}>
            <p className="eyebrow">{routeLabel(a.route)}</p>
            <Progress a={a} />
            {a.status === "requested" && a.route !== "existing-identity" && <p>Your bank is confirming your KYB. This page updates by itself.</p>}
            {a.status === "requested" && a.route === "existing-identity" && <p>Signed. The onboarding agent is registering your wallet against your identity.</p>}
            {a.status === "awaiting-custodian" && <p>Your bank has confirmed your KYB. {a.route === "third-party" ? "Your custodian" : "The custody platform"} is opening your account.</p>}
            {a.status === "awaiting-wallet" && (
              <>
                <p>
                  {a.route === "existing-identity"
                    ? `Connect the wallet to register against your identity ${d.identity}, and sign once.`
                    : "Your bank has confirmed your KYB. Connect your wallet and sign once: the bank then creates your identity, vouches for it, and hands its management to your wallet."}
                </p>
                <BrowserWallet id={a.id} chain={chain} label="Connect MetaMask and sign" start={browserWalletStartAction} finish={browserWalletFinishAction} />
              </>
            )}
            {d.error && <p role="alert" className="notice err">The last step failed: {d.error}</p>}
            {CANCELLABLE.includes(a.status) && (
              <form action={cancelOnboardingAction} className="actions">
                <input type="hidden" name="id" value={a.id} />
                <PendingButton className="quiet" working="Cancelling…">Cancel this request</PendingButton>
              </form>
            )}
          </section>
        );
      })}

      {open.length === 0 && (
        <>
          <p className="lede" style={{ marginTop: 0 }}>
            {onboarded.length ? "Add another account or wallet:" : "Choose how your account is held. Your bank confirms the KYB it already holds; then you may ask for access to the note."}
          </p>
          <div className="cards">
            {ROUTES.map((r) => (
              <section className="panel" key={r.route}>
                <h3 style={{ marginTop: 0 }}>{r.title}</h3>
                <p className="muted">{r.body}</p>
                <form action={requestRouteAction} className="actions">
                  <input type="hidden" name="route" value={r.route} />
                  <PendingButton working="Asking your bank…">Ask my bank to confirm my KYB</PendingButton>
                </form>
              </section>
            ))}
          </div>
          <details className="panel">
            <summary>Already have an identity another institution vouched for?</summary>
            <p className="muted">Bring it: name it, then sign once with its wallet. The onboarding agent relies on the claims it already carries.</p>
            <BringIdentityForm action={bringIdentityAction} />
          </details>
        </>
      )}

      {ended.length > 0 && (
        <p className="muted">
          Earlier: {ended.map((a) => `${routeLabel(a.route)} ${a.status}${dataOf(a).error ? ` (${dataOf(a).error})` : ""}`).join("; ")}.
        </p>
      )}
    </>
  );
}
