import "server-only";
import { getStore, type Admission, type Registrant } from "@/lib/store";
import { participantOf, type Participant } from "@/lib/identity/participants";
import { walletOf } from "@/lib/identity/onboarding";

export { walletOf };

const LIVE = ["requested", "awaiting-wallet", "awaiting-custodian", "failed"];

/**
 * What the client's Onboard pages show: the onboardings in progress, the wallets
 * onboarded for it with their claims as the chain holds them, and what ended.
 */
export async function accountOf(who: Registrant): Promise<{
  open: Admission[];
  onboarded: Participant[];
  ended: Admission[];
  /** The client's own wallet, onboarded. */
  wallet?: Admission;
  /** A custody account held for the client, onboarded. */
  held?: Admission;
  /** Whether the note accepts the client's wallet or account now. */
  noteEligible: boolean;
}> {
  const mine = (await getStore().admissionsFor(who.id)).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const onboarded = (await Promise.all(mine.filter((a) => a.status === "onboarded").map(participantOf))).filter((p): p is Participant => p !== null);
  const own = onboarded.find((p) => ["self-custody", "existing-identity"].includes(p.admission.route));
  const custody = onboarded.find((p) => ["bank-custody", "third-party"].includes(p.admission.route));
  return {
    wallet: own?.admission,
    held: custody?.admission,
    noteEligible: Boolean((own ?? custody)?.eligible.note),
    open: mine.filter((a) => LIVE.includes(a.status)),
    onboarded,
    ended: mine.filter((a) => ["declined", "cancelled", "offboarded"].includes(a.status)).slice(0, 5),
  };
}
