import "server-only";
import { randomBytes } from "node:crypto";
import { getStore, type Client, type Registrant } from "../store.ts";
import { isOperator } from "../operators.ts";
import { policyConfig } from "./protocol.ts";
import { bankConfig, corporateIdentities, issueCredential, type IssuedCredential } from "./bank.ts";
import { claimsFor, type ClientInput } from "./client-claims.ts";

export { CORPORATE_STATUSES, LEGAL_FORMS, recordOf, type ClientInput } from "./client-claims.ts";

/**
 * The bank's corporate clients (ADR 0066). Staff enter a client's facts once; the site sends them
 * as claims to the bank's issuer server, which signs and anchors the corporate identity. Every route
 * then reads the client from here, so nothing the bank verified is typed twice.
 */

const ONE_YEAR = 365 * 86_400;
const now = () => new Date().toISOString();

async function issue(kycReference: string, subjectDid: string, claims: Record<string, unknown>) {
  const policy = policyConfig();
  return issueCredential(bankConfig(), { schema: policy.schemas.corporateIdentity, subjectDid, kycReference, validitySeconds: ONE_YEAR, claims });
}

/** Adds a corporate client and has the bank issue its corporate identity. */
export async function addClient(staff: Registrant, input: ClientInput): Promise<Client> {
  if (!isOperator(staff.email)) throw new Error("Not permitted.");
  const store = getStore();
  const checked = claimsFor(input, policyConfig().issuerDid);
  if ("problems" in checked) throw new Error(`Not added: ${checked.problems.join("; ")}.`);
  const kycReference = input.kycReference.trim();
  if (await store.clientByReference(kycReference)) throw new Error(`Not added: a client with reference ${kycReference} already exists.`);
  const issued = await issue(kycReference, checked.subjectDid, checked.claims);
  const c: Client = {
    id: `cli_${randomBytes(9).toString("base64url")}`,
    kycReference,
    subjectDid: checked.subjectDid,
    claims: checked.claims,
    credentialId: issued.credentialId,
    issuanceId: issued.issuanceId,
    pickupUrl: issued.pickupUrl,
    issuedAt: now(),
    issuedBy: staff.email,
    createdAt: now(),
    previous: [],
  };
  await store.putClient(c);
  await store.audit({ at: now(), actor: staff.email, action: `added client ${kycReference} (${checked.claims.legalName}); the bank issued its corporate identity ${issued.credentialId}`, subject: c.id });
  return c;
}

/**
 * Re-screens a client: the same facts, issued again, so the screening date is today. The earlier
 * credential stays valid for the admissions resting on it until it expires or is revoked.
 */
export async function rescreenClient(staff: Registrant, id: string): Promise<Client> {
  if (!isOperator(staff.email)) throw new Error("Not permitted.");
  const store = getStore();
  const c = await store.clientById(id);
  if (!c) throw new Error("No such client.");
  const issued = await issue(c.kycReference, c.subjectDid, c.claims);
  const next: Client = {
    ...c,
    credentialId: issued.credentialId,
    issuanceId: issued.issuanceId,
    pickupUrl: issued.pickupUrl,
    issuedAt: now(),
    issuedBy: staff.email,
    previous: [...c.previous, { credentialId: c.credentialId, issuedAt: c.issuedAt }],
  };
  await store.updateClient(next);
  await store.audit({ at: now(), actor: staff.email, action: `re-screened client ${c.kycReference}; the bank issued ${issued.credentialId}`, subject: c.id });
  return next;
}

/** Corporate identities the bank holds that this site did not issue: to be re-issued here before use. */
export async function clientsIssuedElsewhere(): Promise<IssuedCredential[]> {
  const ours = new Set((await getStore().listClients()).map((c) => c.kycReference));
  const theirs = await corporateIdentities(bankConfig(), policyConfig().schemas.corporateIdentity, Math.floor(Date.now() / 1000));
  return theirs.filter((c) => c.kycReference && !ours.has(c.kycReference));
}
