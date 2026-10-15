import "server-only";
import type { Address } from "viem";
import { getStore, type Admission } from "../store.ts";
import { claimsOf, eligibility, poolStanding, type ClaimView, type Standing, type Topic } from "./onchain.ts";
import { dataOf } from "./onboarding.ts";

/**
 * Onboarded wallets with their claims as the chain holds them now (ADRs 0089, 0090): whether each
 * institution's claim stands, until when, whether the wallet may hold each asset, and what the
 * conversion pool's gate says of it.
 */

export type Participant = {
  admission: Admission;
  wallet: Address;
  identity: Address;
  claims: Record<Topic, ClaimView>;
  eligible: { deposit: boolean; note: boolean; pool: boolean };
  /** What the conversion pool's gate says of the wallet; null where there is no pool. */
  pool: Standing | null;
};

/** Reads the chain for one onboarding; null for one with no identity yet, or if the chain cannot be read. */
export async function participantOf(a: Admission): Promise<Participant | null> {
  const d = dataOf(a);
  if (!d.wallet || !d.identity) return null;
  try {
    const [claims, eligible, pool] = await Promise.all([claimsOf(d.identity), eligibility(d.wallet), poolStanding(d.wallet)]);
    return { admission: a, wallet: d.wallet, identity: d.identity, claims, eligible, pool };
  } catch {
    return null;
  }
}

/** Every onboarding that reached an identity, newest first, with its claims read from the chain. */
export async function participants(filter: (a: Admission) => boolean = () => true): Promise<Participant[]> {
  const all = (await getStore().listAdmissions(500)).filter((a) => ["onboarded", "offboarded"].includes(a.status) && filter(a));
  return (await Promise.all(all.map(participantOf))).filter((p): p is Participant => p !== null);
}

/** A claim, in a few words: whether it stands, and until when. */
export function claimState(c: ClaimView): { label: string; pill: "approved" | "pending" | "revoked" } {
  if (!c.present) return { label: "none", pill: "pending" };
  if (c.revoked) return { label: "revoked", pill: "revoked" };
  if (!c.valid) return { label: c.validUntil && c.validUntil * 1000 < Date.now() ? "lapsed" : "invalid", pill: "revoked" };
  return { label: `until ${new Date(c.validUntil * 1000).toISOString().slice(0, 10)}`, pill: "approved" };
}
