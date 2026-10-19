import { JURISDICTIONS } from "../jurisdictions.ts";

/**
 * A corporate client's facts, as the bank's staff enter them: checked here, kept in the
 * bank's portal, and carried on-chain only as a salted hash in the bank's claim. Pure, so it is
 * unit-tested on its own.
 */

export const LEGAL_FORMS = ["LLC", "FZ-LLC", "PLC", "PJSC", "GmbH", "Inc", "Corp", "LLP", "PartnershipLP", "PartnershipLLP", "SoleProprietorship"] as const;
export const CORPORATE_STATUSES = ["active", "dissolved", "suspended", "in-liquidation"] as const;
export const INVESTOR_CLASSES = ["sophisticated", "professional", "institutional", "retail"] as const;

export type ClientInput = {
  /** Assigned by the site when absent. */
  kycReference?: string;
  legalName: string;
  legalForm: string;
  registrationNumber: string;
  jurisdiction: string;
  incorporationDate: string;
  status: string;
  investorClass?: string;
};

/** Checks the facts; returns them as the bank records them, or the problems. */
export function factsFor(
  input: ClientInput,
  today = new Date().toISOString().slice(0, 10),
): { facts: Record<string, string>; kycReference: string } | { problems: string[] } {
  const problems: string[] = [];
  const t = (v?: string) => (v ?? "").trim();
  const kycReference = t(input.kycReference);
  if (!kycReference) problems.push("the client's reference at the bank is missing");
  if (!t(input.legalName)) problems.push("the legal name is missing");
  if (!(LEGAL_FORMS as readonly string[]).includes(t(input.legalForm))) problems.push(`choose a legal form (${t(input.legalForm) || "none"})`);
  if (!t(input.registrationNumber)) problems.push("the registration number is missing");
  const jurisdiction = t(input.jurisdiction).toUpperCase();
  if (!JURISDICTIONS.some(([c]) => c === jurisdiction)) problems.push(`choose a jurisdiction (${jurisdiction || "none"})`);
  const inc = t(input.incorporationDate);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(inc) || inc > today) problems.push("the incorporation date must be a date, not in the future");
  if (!(CORPORATE_STATUSES as readonly string[]).includes(t(input.status))) problems.push(`choose a status (${t(input.status) || "none"})`);
  const investorClass = t(input.investorClass);
  if (investorClass && !(INVESTOR_CLASSES as readonly string[]).includes(investorClass)) problems.push(`unknown investor class (${investorClass})`);
  if (problems.length) return { problems };
  return {
    kycReference,
    facts: {
      legalName: t(input.legalName),
      legalForm: t(input.legalForm),
      registrationNumber: t(input.registrationNumber),
      jurisdiction,
      incorporationDate: inc,
      status: t(input.status),
      ...(investorClass ? { investorClass } : {}),
    },
  };
}
