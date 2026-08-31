/**
 * Synthetic applicant data for demo sign-ups.
 *
 * Every value here is invented. The point is that a prospect can create an account with their
 * own email and immediately have a plausible, half-complete file to work through — so the demo
 * shows the real shape of onboarding rather than an empty form.
 *
 * Two deliberate choices:
 *   - individual or entity is decided from the email, so it is stable per account but varies
 *     across sign-ups and both paths get shown;
 *   - the generated financials clear the accreditation test, so the happy path works. Editing
 *     them downward in the admin view is how you demonstrate a retail investor being refused.
 */

import { createHash } from "node:crypto";

const FIRST = ["Mei", "Jun", "Aiko", "Ravi", "Siti", "Wen", "Hana", "Arjun", "Ling", "Kenji", "Priya", "Daniel"];
const LAST = ["Tan", "Leung", "Mori", "Sharma", "Rahman", "Chen", "Watanabe", "Nair", "Wong", "Sato", "Iyer", "Lim"];

const JURISDICTIONS = [
  { name: "Singapore", code: 702, city: "Singapore", street: "Marina Boulevard", post: "018981" },
  { name: "Hong Kong", code: 344, city: "Hong Kong", street: "Connaught Road Central", post: "" },
  { name: "Japan", code: 392, city: "Tokyo", street: "Marunouchi", post: "100-0005" },
  { name: "Australia", code: 36, city: "Sydney", street: "Macquarie Street", post: "NSW 2000" },
];

const ENTITY_FORMS = [
  "Private limited company",
  "Family office",
  "Unit trust",
  "Licensed fund manager",
  "Discretionary trust",
];

const ENTITY_PREFIX = ["Meridian", "Kestrel", "Anchorage", "Lotus", "Blue Harbour", "Summit", "Orchard", "Pacific Rim"];
const ENTITY_SUFFIX = ["Capital Partners", "Asset Management", "Holdings", "Investments", "Family Office"];
/**
 * A third element, because prefix x suffix alone is only 40 combinations — enough that a handful
 * of sign-ups at an event produced two identically named entities in the review queue, which is
 * confusing even though their references differ.
 */
const ENTITY_QUALIFIER = ["", " (Asia)", " (Pacific)", " II", " Group", " SG", " International", " Partners"];

const SOURCES = [
  "Proceeds from sale of a private company",
  "Accumulated investment income",
  "Family office allocation",
  "Sale of listed securities",
  "Distributions from a discretionary trust",
];

function seedOf(email: string): number[] {
  const h = createHash("sha256").update(email.trim().toLowerCase()).digest();
  return Array.from(h.subarray(0, 16));
}
const pick = <T,>(arr: T[], n: number): T => arr[n % arr.length];

export type GeneratedProfile = {
  accountType: "individual" | "entity";
  applicantName: string;
  country: number;
  phone: string;
  sourceOfFunds: string;
  // individual
  legalName?: string;
  dob?: string;
  nationality?: string;
  taxId?: string;
  annualIncome?: number;
  netFinancialAssets?: number;
  // entity
  entityName?: string;
  entityForm?: string;
  registrationNumber?: string;
  incorporationCountry?: string;
  registeredOffice?: string;
  repName?: string;
  entityNetAssets?: number;
  // screening, pre-run by the provider
  sanctionsResult: string;
  pepResult: string;
  adverseMediaResult: string;
  startingCash: string;
  /** What the applicant still has to supply. Left blank on purpose. */
  outstanding: string[];
};

export function generateProfile(email: string): GeneratedProfile {
  const s = seedOf(email);
  const isEntity = s[0] % 2 === 1;
  const j = pick(JURISDICTIONS, s[1]);
  const today = "2026-08-19";
  const screening = {
    sanctionsResult: `No match — screened ${today}`,
    pepResult: `No match — screened ${today}`,
    adverseMediaResult: `No findings — screened ${today}`,
  };
  // A flat opening balance, the same for everyone: the demo is about what compliance permits, not
  // about who happens to have been dealt more cash.
  const startingCash = "100000";

  if (isEntity) {
    const name = `${pick(ENTITY_PREFIX, s[3])} ${pick(ENTITY_SUFFIX, s[4])}${pick(ENTITY_QUALIFIER, s[15])}`;
    return {
      accountType: "entity",
      applicantName: name,
      entityName: `${name} Pte Ltd`,
      entityForm: pick(ENTITY_FORMS, s[5]),
      registrationNumber: `${200000000 + s[6] * 7919}${String.fromCharCode(65 + (s[7] % 26))}`,
      incorporationCountry: j.name,
      country: j.code,
      // Comfortably over the S$10m entity threshold, so the happy path approves.
      entityNetAssets: 12_000_000 + (s[8] % 40) * 1_000_000,
      repName: `${pick(FIRST, s[9])} ${pick(LAST, s[10])}`,
      phone: `+65 6${String(1000000 + s[11] * 3571).slice(0, 7)}`,
      sourceOfFunds: pick(SOURCES, s[12]),
      ...screening,
      startingCash,
      // A corporate file cannot be signed off without these.
      outstanding: ["registeredOffice", "repPassportNumber"],
    };
  }

  const first = pick(FIRST, s[3]);
  const last = pick(LAST, s[4]);
  const initial = pick(FIRST, s[15])[0];
  return {
    accountType: "individual",
    applicantName: `${first} ${initial}. ${last}`,
    legalName: `${first} ${pick(FIRST, s[5])} ${last}`,
    dob: `19${60 + (s[6] % 35)}-${String(1 + (s[7] % 12)).padStart(2, "0")}-${String(1 + (s[8] % 28)).padStart(2, "0")}`,
    nationality: j.name,
    country: j.code,
    taxId: `${j.code}-${String(100000 + s[9] * 431).slice(0, 6)}-${String.fromCharCode(65 + (s[10] % 26))}`,
    // Clears the MAS individual test on the assets limb.
    netFinancialAssets: 1_400_000 + (s[11] % 30) * 100_000,
    annualIncome: 180_000 + (s[12] % 20) * 15_000,
    phone: `+65 9${String(1000000 + s[13] * 2749).slice(0, 7)}`,
    sourceOfFunds: pick(SOURCES, s[14]),
    ...screening,
    startingCash,
    // The two things a natural-person file always chases.
    outstanding: ["residentialAddress", "passportNumber"],
  };
}

/** A plausible value to offer as a suggestion for an outstanding field. */
export function suggestionFor(field: string, email: string): string {
  const s = seedOf(email);
  const j = pick(JURISDICTIONS, s[1]);
  switch (field) {
    case "residentialAddress":
      return `${10 + (s[2] % 80)} ${j.street}, ${j.city} ${j.post}`.trim();
    case "registeredOffice":
      return `Level ${5 + (s[3] % 30)}, ${20 + (s[4] % 60)} ${j.street}, ${j.city} ${j.post}`.trim();
    case "passportNumber":
    case "repPassportNumber":
      return `${String.fromCharCode(69 + (s[5] % 6))}${String(1000000 + s[6] * 5171).slice(0, 7)}`;
    default:
      return "";
  }
}
