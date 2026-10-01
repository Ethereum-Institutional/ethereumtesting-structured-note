import "server-only";
import { getStore, type Admission, type Registrant } from "@/lib/store";
import { custodyFor, kybReferenceOf } from "@/lib/admission/service";

/** The routes a client takes itself. A custodied admission is the bank's own act (ADR 0062). */
export const CLIENT_ROUTES = ["self-custody", "holder-wallet"] as const;
const ENDED = ["refused", "admitted", "declined", "cancelled", "offboarded", "failed"];

export const walletOf = (a: Admission) => String((a.data as Record<string, any>).assessment?.summary?.wallet ?? (a.data as Record<string, any>).account ?? "") as `0x${string}`;

/**
 * What the client's Onboard pages show (ADR 0076): the request in progress, if any; the accounts
 * onboarded for it, its own wallet or the custody account its bank holds; and what it may do next.
 */
export async function accountOf(who: Registrant) {
  const store = getStore();
  const [latest, mine, kyb, custody] = await Promise.all([
    store.latestAdmissionFor(who.id, [...CLIENT_ROUTES]),
    store.admissionsFor(who.id),
    kybReferenceOf(who),
    custodyFor(who),
  ]);
  const client = kyb ? await store.clientByReference(kyb) : null;
  const own = mine.filter((x) => (CLIENT_ROUTES as readonly string[]).includes(x.route));
  const wallet = own.find((x) => x.status === "admitted");
  const held = custody.find((x) => x.status === "admitted");
  const open = latest && !ENDED.includes(latest.status) ? latest : undefined;
  return {
    latest,
    open,
    /** The client's own wallet, onboarded on the third-party or holder-wallet route. */
    wallet,
    /** The custody account the bank holds on the client's KYB. */
    held,
    /** Whether the bank has confirmed a KYB for the client here: it then binds by signature alone. */
    kyb,
    viaHolder: own.some((x) => x.route === "holder-wallet" && ["admitted", "offboarded"].includes(x.status)),
    custodyRequest: client?.custodyRequest,
    earlier: [...own, ...custody].filter((x) => x.status === "offboarded").sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
  };
}
