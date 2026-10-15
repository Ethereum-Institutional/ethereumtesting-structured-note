import "server-only";
import { randomBytes } from "node:crypto";
import { getStore, type Client, type Registrant } from "../store.ts";
import { hasRole } from "../operators.ts";
import { recordHash } from "./onchain.ts";
import { factsFor, type ClientInput } from "./facts.ts";

export { CORPORATE_STATUSES, INVESTOR_CLASSES, LEGAL_FORMS, type ClientInput } from "./facts.ts";

/**
 * The bank's corporate clients (ADR 0089). Staff enter a client's facts once. They stay here, in
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
