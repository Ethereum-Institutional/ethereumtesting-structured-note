import { randomBytes } from "node:crypto";
import { JURISDICTIONS } from "../jurisdictions.ts";
import type { Client } from "../store.ts";
import { INVESTOR_CLASSES, type BankRecord } from "./assess.ts";

/**
 * A client's facts as corporate identity claims (ADR 0066): checked against the schema, with a DID
 * made where the client has none. Pure, so it is unit-tested on its own.
 */

/** The corporate identity schema's values (elabify corporateIdentity v1). */
export const LEGAL_FORMS = ["LLC", "FZ-LLC", "PLC", "PJSC", "GmbH", "Inc", "Corp", "LLP", "PartnershipLP", "PartnershipLLP", "SoleProprietorship"] as const;
export const CORPORATE_STATUSES = ["active", "dissolved", "suspended", "in-liquidation"] as const;
const DID = /^did:elabify:[a-zA-Z0-9_-]+:[a-zA-Z0-9_-]+:[A-Za-z0-9_:.x-]+$/;

export type ClientInput = {
  kycReference: string;
  subjectDid?: string;
  legalName: string;
  legalForm: string;
  registrationNumber: string;
  jurisdiction: string;
  incorporationDate: string;
  status: string;
  investorClass?: string;
  ceoOfficerDid?: string;
  cooOfficerDid?: string;
  cfoOfficerDid?: string;
};

const now = () => new Date().toISOString();

/** A DID for a client that has none: in the issuer's network, held by no one, as custody needs. */
export function clientDid(issuerDid: string, kycReference: string): string {
  const network = issuerDid.match(/^did:elabify:([A-Za-z0-9_-]+):/)?.[1] ?? "local";
  const slug = kycReference.replace(/[^A-Za-z0-9_.-]+/g, "-").replace(/^-+|-+$/g, "") || randomBytes(6).toString("hex");
  return `did:elabify:${network}:client:${slug}`;
}

/** Checks the facts against the schema; returns the claims to issue, or the problems. */
export function claimsFor(input: ClientInput, issuerDid: string, today = now().slice(0, 10)): { claims: Record<string, unknown>; subjectDid: string } | { problems: string[] } {
  const problems: string[] = [];
  const t = (v?: string) => (v ?? "").trim();
  const kycReference = t(input.kycReference);
  if (!kycReference) problems.push("the client's reference at the bank is missing");
  const subjectDid = t(input.subjectDid) || clientDid(issuerDid, kycReference);
  if (!DID.test(subjectDid)) problems.push(`the client's DID is not a did:elabify DID (${subjectDid})`);
  if (!t(input.legalName)) problems.push("the legal name is missing");
  if (!(LEGAL_FORMS as readonly string[]).includes(t(input.legalForm))) problems.push(`choose a legal form (${t(input.legalForm) || "none"})`);
  if (!t(input.registrationNumber)) problems.push("the registration number is missing");
  const jurisdiction = t(input.jurisdiction).toUpperCase();
  if (!JURISDICTIONS.some(([c]) => c === jurisdiction)) problems.push(`choose a jurisdiction (${jurisdiction || "none"})`);
  const inc = t(input.incorporationDate);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(inc) || inc > today) problems.push("the incorporation date must be a date, not in the future");
  if (!(CORPORATE_STATUSES as readonly string[]).includes(t(input.status))) problems.push(`choose a status (${t(input.status) || "none"})`);
  const investorClass = t(input.investorClass);
  if (investorClass && !INVESTOR_CLASSES.includes(investorClass)) problems.push(`unknown investor class (${investorClass})`);
  const officers: Record<string, string> = {};
  for (const slot of ["ceoOfficerDid", "cooOfficerDid", "cfoOfficerDid"] as const) {
    const v = t(input[slot]);
    if (!v) continue;
    if (!DID.test(v)) problems.push(`the ${slot.slice(0, 3).toUpperCase()}'s DID is not a did:elabify DID (${v})`);
    officers[slot] = v;
  }
  if (problems.length) return { problems };
  return {
    subjectDid,
    claims: {
      id: subjectDid,
      legalName: t(input.legalName),
      legalForm: t(input.legalForm),
      registrationNumber: t(input.registrationNumber),
      jurisdiction,
      incorporationDate: inc,
      status: t(input.status),
      ...(investorClass ? { investorClass } : {}),
      ...officers,
    },
  };
}

/** The bank's record of a client, as routes 1 and 2 rest on it: read from the client, never retyped. */
export function recordOf(c: Client): BankRecord {
  return {
    kycReference: c.kycReference,
    legalName: String(c.claims.legalName),
    jurisdiction: String(c.claims.jurisdiction),
    status: String(c.claims.status),
    screenedAt: Math.floor(Date.parse(c.issuedAt) / 1000),
    ...(c.claims.investorClass ? { investorClass: String(c.claims.investorClass) } : {}),
  };
}

