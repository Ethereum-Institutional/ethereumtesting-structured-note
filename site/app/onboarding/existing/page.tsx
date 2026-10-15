import { getStore } from "@/lib/store";
import { dataOf } from "@/lib/identity/onboarding";
import { acceptExistingAction } from "../../actions";
import { ActionForm } from "../../staff/ActionForm";
import { when } from "../../staff/parts";

export const dynamic = "force-dynamic";

/**
 * Identities brought from elsewhere (Q2): a client whose identity already carries the note claim
 * from an issuer the note trusts, having signed for its wallet. Registering it relies on that claim.
 */
export default async function ExistingIdentities() {
  const waiting = (await getStore().listAdmissions(500)).filter((a) => a.route === "existing-identity" && a.status === "requested");
  return (
    <>
      <h2 id="existing">Existing identities</h2>
      <p className="muted panel">
        A client may bring an identity another institution has already vouched for. Once its wallet has signed, registering the
        wallet against the identity relies on the claims the identity carries: the note accepts it if an issuer it trusts
        vouches for it, and the registration is undone if none does.
      </p>
      {waiting.length === 0 && <p className="muted panel">No identity is waiting.</p>}
      {waiting.map((a) => {
        const d = dataOf(a);
        return (
          <section className="panel" key={a.id}>
            <p className="eyebrow">Brought {when(a.createdAt)}</p>
            <h3 style={{ margin: "0.25rem 0 1rem" }}>{d.request?.organisation}</h3>
            <dl className="facts">
              <dt>Identity</dt><dd><code>{d.identity}</code></dd>
              <dt>Wallet</dt><dd><code>{d.wallet}</code> <span className="muted">(signed)</span></dd>
            </dl>
            <ActionForm action={acceptExistingAction} hidden={{ id: a.id }} label="Register the wallet" working="Registering and checking the note's registry…" />
          </section>
        );
      })}
    </>
  );
}
