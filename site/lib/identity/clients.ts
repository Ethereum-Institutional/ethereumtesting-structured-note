import "server-only";
import { randomBytes } from "node:crypto";
import { getStore, type Client, type Registrant } from "../store.ts";
import { hasRole } from "../operators.ts";
import { recordHash } from "./onchain.ts";
import { factsFor, type ClientInput } from "./facts.ts";

export { CORPORATE_STATUSES, INVESTOR_CLASSES, LEGAL_FORMS, type ClientInput } from "./facts.ts";

/**
 * The bank's corporate clients. Staff enter a client's facts once. They stay here, in
 * the bank's portal; what reaches the chain is the bank's claim, carrying the record's salted hash.
 * Every route then reads the client from here, so nothing the bank verified is typed twice.
 */

/** A client reference the site assigns: the date, and four characters no one confuses. */
function newReference(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const tail = [...randomBytes(4)].map((b) => alphabet[b % alphabet.length]).join("");
  return `CLI-${new Date().toISOString().slice(2, 10).replaceAll("-", "")}-${tail}`;
}
const now = () => new Date().toISOString();
const salt = () => `0x${randomBytes(32).toString("hex")}` as const;

/** The record a claim's hash is taken over: the facts, the reference, and when they were verified. */
export function recordOf(c: Pick<Client, "kycReference" | "claims" | "issuedAt">): Record<string, unknown> {
  return { kycReference: c.kycReference, facts: c.claims, verifiedAt: c.issuedAt };
}

/** Adds a corporate client to the bank's records. */
export async function addClient(staff: Registrant, input: ClientInput): Promise<Client> {
  if (!hasRole(staff.email, "bank")) throw new Error("Not permitted.");
  const store = getStore();
  const checked = factsFor({ ...input, kycReference: input.kycReference?.trim() || newReference() });
  if ("problems" in checked) throw new Error(`Not added: ${checked.problems.join("; ")}.`);
  const kycReference = checked.kycReference;
  if (await store.clientByReference(kycReference)) throw new Error(`Not added: a client with reference ${kycReference} already exists.`);
  const issuedAt = now();
  const s = salt();
  const c: Client = {
    id: `cli_${randomBytes(9).toString("base64url")}`,
    kycReference,
    claims: checked.facts,
    salt: s,
    recordHash: recordHash(recordOf({ kycReference, claims: checked.facts, issuedAt }), s),
    issuedAt,
    issuedBy: staff.email,
    createdAt: issuedAt,
    previous: [],
  };
  await store.putClient(c);
  await store.audit({ at: now(), actor: staff.email, action: `added client ${kycReference} (${checked.facts.legalName}) to the bank's records`, subject: c.id });
  return c;
}

/**
 * Re-screens a client: the same facts, verified again today, under a fresh salt. Claims already
 * added keep the earlier hash until the bank renews them.
 */
export async function rescreenClient(staff: Registrant, id: string): Promise<Client> {
  if (!hasRole(staff.email, "bank")) throw new Error("Not permitted.");
  const store = getStore();
  const c = await store.clientById(id);
  if (!c) throw new Error("No such client.");
  const issuedAt = now();
  const s = salt();
  const next: Client = {
    ...c,
    salt: s,
    recordHash: recordHash(recordOf({ ...c, issuedAt }), s),
    issuedAt,
    issuedBy: staff.email,
    previous: [...c.previous, { recordHash: c.recordHash, issuedAt: c.issuedAt }],
  };
  await store.updateClient(next);
  await store.audit({ at: now(), actor: staff.email, action: `re-screened client ${c.kycReference}`, subject: c.id });
  return next;
}

/** Onboardings still in progress: confirmed against a client, not yet on the chain. */
const IN_PROGRESS = ["awaiting-wallet", "awaiting-custodian", "failed"] as const;

/**
 * Removes a client from the bank's records, so that it can be added again with its facts put
 * right. Refused while any account onboarded for it is on the chain, since that account's
 * bank claim carries this record's hash: the bank offboards it first. Onboardings in progress go
 * back to waiting for the bank, to be confirmed against the client as it is added again.
 */
export async function removeClient(staff: Registrant, id: string, reason: string): Promise<{ returned: number }> {
  if (!hasRole(staff.email, "bank")) throw new Error("Not permitted.");
  if (!reason.trim()) throw new Error("Give the reason.");
  const store = getStore();
  const c = await store.clientById(id);
  if (!c) throw new Error("No such client.");
  const ofClient = (await store.listAdmissions(10_000)).filter((a) => (a.data as { kycReference?: string }).kycReference === c.kycReference);
  const onChain = ofClient.filter((a) => a.status === "onboarded");
  if (onChain.length) {
    const wallets = onChain.map((a) => (a.data as { wallet?: string }).wallet ?? a.id).join(", ");
    throw new Error(`${c.kycReference} has ${onChain.length === 1 ? "an account" : `${onChain.length} accounts`} onboarded on the chain (${wallets}), whose bank claim carries this record's hash. Offboard ${onChain.length === 1 ? "it" : "them"} under Onboarding first.`);
  }
  let returned = 0;
  for (const a of ofClient.filter((x) => (IN_PROGRESS as readonly string[]).includes(x.status))) {
    const { kycReference: _k, custodian: _c, challenge: _ch, wallet: _w, error: _e, ...rest } = a.data as Record<string, unknown>;
    if (await store.updateAdmission({ ...a, status: "requested", data: { ...rest, returned: { by: staff.email, at: now(), reason: `client ${c.kycReference} removed: ${reason.trim()}` } } }, a.status)) returned++;
  }
  await store.deleteClient(c.id);
  await store.audit({ at: now(), actor: staff.email, action: `removed client ${c.kycReference} (${String(c.claims.legalName)}) from the bank's records: ${reason.trim()}${returned ? `; ${returned} onboarding${returned === 1 ? "" : "s"} returned to the bank` : ""}`, subject: c.id });
  return { returned };
}
