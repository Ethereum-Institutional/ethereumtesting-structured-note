/** Shared shapes for the platform store. No server-only import: client views use these too. */

export type Role = "admin" | "investor";
export type AccountType = "individual" | "entity";
export type ApplicationStatus = "draft" | "submitted" | "in_review" | "approved" | "rejected";
export type AccreditationLevel = "retail" | "accredited" | "institutional";

export type User = {
  id: string;
  email: string;
  role: Role;
  displayName: string | null;
  createdAt: string;
  lastLoginAt: string | null;
};

export type Application = {
  id: string;
  reference: string;
  userId: string | null;
  applicantName: string;
  wallet: string;
  status: ApplicationStatus;
  submittedAt: string | null;
  accountType: AccountType;

  legalName: string | null;
  dob: string | null;
  nationality: string | null;
  residentialAddress: string | null;
  passportNumber: string | null;
  taxId: string | null;

  entityName: string | null;
  entityForm: string | null;
  registrationNumber: string | null;
  incorporationCountry: string | null;
  registeredOffice: string | null;
  repName: string | null;
  repPassportNumber: string | null;

  country: number | null;
  phone: string | null;
  sourceOfFunds: string | null;

  annualIncome: number | null;
  netFinancialAssets: number | null;
  entityNetAssets: number | null;
  accreditationLevel: AccreditationLevel;
  accreditationBasis: string | null;

  sanctionsResult: string | null;
  pepResult: string | null;
  adverseMediaResult: string | null;

  allocation: string | null;
  startingCash: string | null;
  reviewerNotes: string | null;
  rejectionReason: string | null;

  onchainIdentity: string | null;
  claimDigest: string | null;
  approvedAt: string | null;
  approvedBy: string | null;
  updatedAt: string;
};

export type ApplicationEvent = {
  id: number;
  applicationId: string;
  at: string;
  actor: string;
  action: string;
  detail: string | null;
};

// --------------------------------------------------------------------- //
//                             Accreditation                             //
// --------------------------------------------------------------------- //

/**
 * Thresholds follow the MAS accredited-investor test, since Singapore is the reference
 * jurisdiction for this demo. Amounts are in SGD.
 *
 * Individuals qualify on either limb — assets or income — which is why the basis is recorded
 * alongside the level: a compliance file has to say *why* someone qualified, not just that
 * they did.
 */
export const THRESHOLDS = {
  individualNetFinancialAssets: 1_000_000,
  individualAnnualIncome: 300_000,
  entityNetAssets: 10_000_000,
  institutionalNetAssets: 100_000_000,
} as const;

/** Entity forms that are institutional by regulated status rather than by size. */
const INSTITUTIONAL_FORMS = ["bank", "insurer", "licensed fund manager", "sovereign wealth fund", "pension fund"];

export function assessAccreditation(app: Application): { level: AccreditationLevel; basis: string } {
  if (app.accountType === "entity") {
    const form = (app.entityForm ?? "").toLowerCase();
    if (INSTITUTIONAL_FORMS.some((f) => form.includes(f))) {
      return { level: "institutional", basis: `Regulated entity type: ${app.entityForm}` };
    }
    const net = app.entityNetAssets ?? 0;
    if (net >= THRESHOLDS.institutionalNetAssets) {
      return { level: "institutional", basis: `Net assets S$${fmt(net)} ≥ S$${fmt(THRESHOLDS.institutionalNetAssets)}` };
    }
    if (net >= THRESHOLDS.entityNetAssets) {
      return { level: "accredited", basis: `Net assets S$${fmt(net)} ≥ S$${fmt(THRESHOLDS.entityNetAssets)}` };
    }
    return {
      level: "retail",
      basis: `Net assets S$${fmt(net)} below the S$${fmt(THRESHOLDS.entityNetAssets)} entity threshold`,
    };
  }

  const assets = app.netFinancialAssets ?? 0;
  const income = app.annualIncome ?? 0;
  const byAssets = assets >= THRESHOLDS.individualNetFinancialAssets;
  const byIncome = income >= THRESHOLDS.individualAnnualIncome;

  if (byAssets && byIncome) {
    return {
      level: "accredited",
      basis: `Net financial assets S$${fmt(assets)} and income S$${fmt(income)} both meet the test`,
    };
  }
  if (byAssets) {
    return { level: "accredited", basis: `Net financial assets S$${fmt(assets)} ≥ S$${fmt(THRESHOLDS.individualNetFinancialAssets)}` };
  }
  if (byIncome) {
    return { level: "accredited", basis: `Annual income S$${fmt(income)} ≥ S$${fmt(THRESHOLDS.individualAnnualIncome)}` };
  }
  return {
    level: "retail",
    basis: `Net financial assets S$${fmt(assets)} and income S$${fmt(income)} are both below the threshold`,
  };
}

function fmt(n: number): string {
  return n.toLocaleString("en-SG", { maximumFractionDigits: 0 });
}

/** The fund is restricted: retail investors cannot be admitted at all. */
export function accreditationPermitsApproval(level: AccreditationLevel): boolean {
  return level === "accredited" || level === "institutional";
}

// --------------------------------------------------------------------- //
//                           Field requirements                          //
// --------------------------------------------------------------------- //

export const FIELD_LABELS: Record<string, string> = {
  applicantName: "Account name",
  accountType: "Account type",
  legalName: "Full legal name",
  dob: "Date of birth",
  nationality: "Nationality",
  residentialAddress: "Residential address",
  passportNumber: "Passport number",
  taxId: "Tax identification number",
  entityName: "Registered entity name",
  entityForm: "Entity form",
  registrationNumber: "Registration number",
  incorporationCountry: "Country of incorporation",
  registeredOffice: "Registered office address",
  repName: "Authorised representative",
  repPassportNumber: "Representative passport number",
  country: "Jurisdiction (ISO-3166 numeric)",
  phone: "Contact number",
  sourceOfFunds: "Source of funds",
  annualIncome: "Annual income (SGD)",
  netFinancialAssets: "Net financial assets (SGD)",
  entityNetAssets: "Entity net assets (SGD)",
  sanctionsResult: "Sanctions screening",
  pepResult: "PEP screening",
  adverseMediaResult: "Adverse media",
  allocation: "Subscription (units)",
  reviewerNotes: "Reviewer notes",
  accreditationBasis: "Accreditation basis",
};

const INDIVIDUAL_REQUIRED = [
  "legalName",
  "dob",
  "nationality",
  "residentialAddress",
  "passportNumber",
  "taxId",
  "sourceOfFunds",
] as const;

const ENTITY_REQUIRED = [
  "entityName",
  "entityForm",
  "registrationNumber",
  "incorporationCountry",
  "registeredOffice",
  "repName",
  "repPassportNumber",
  "sourceOfFunds",
] as const;

/** What the investor must supply before the file can be submitted for review. */
export function requiredFields(accountType: AccountType): string[] {
  return accountType === "entity" ? [...ENTITY_REQUIRED] : [...INDIVIDUAL_REQUIRED];
}

export function missingFields(app: Application): string[] {
  const required = requiredFields(app.accountType);
  const gaps = required.filter((f) => {
    const v = (app as any)[f];
    return v === null || v === undefined || String(v).trim() === "";
  });
  // Accreditation cannot be assessed without the figures it depends on.
  if (app.accountType === "entity") {
    if (app.entityNetAssets == null) gaps.push("entityNetAssets");
  } else if (app.netFinancialAssets == null && app.annualIncome == null) {
    gaps.push("netFinancialAssets");
  }
  if (app.country == null) gaps.push("country");
  return gaps;
}

export function isComplete(app: Application): boolean {
  return missingFields(app).length === 0;
}

/** Fields the admin may edit directly, in display order. */
export function adminEditableFields(accountType: AccountType): string[] {
  const shared = [
    "applicantName",
    "country",
    "phone",
    "sourceOfFunds",
    "annualIncome",
    "netFinancialAssets",
    "sanctionsResult",
    "pepResult",
    "adverseMediaResult",
    "allocation",
    "reviewerNotes",
  ];
  return accountType === "entity"
    ? [
        "entityName", "entityForm", "registrationNumber", "incorporationCountry",
        "registeredOffice", "repName", "repPassportNumber", "entityNetAssets", ...shared,
      ]
    : ["legalName", "dob", "nationality", "residentialAddress", "passportNumber", "taxId", ...shared];
}

export const NUMERIC_FIELDS = new Set(["annualIncome", "netFinancialAssets", "entityNetAssets", "country"]);

/**
 * Jurisdictions the fund may be distributed into.
 *
 * Validated rather than free-typed because `country` is passed to
 * `registerIdentity(address,address,uint16)` on approval: a value outside uint16 fails to encode,
 * and one outside the issuer's country module would be registered but unable to transfer. Either
 * way the investor ends up in a state that cannot be approved, with a confusing error.
 */
export const PERMITTED_COUNTRIES: Record<number, string> = {
  702: "Singapore",
  344: "Hong Kong",
  392: "Japan",
  36: "Australia",
};

/** A generous but finite ceiling, so a declared figure stays a plausible number. */
const MAX_MONEY = 1_000_000_000_000; // S$1tn
const MAX_TEXT = 500;

/**
 * Validates and coerces a submitted patch.
 *
 * Returns the fields that are safe to write, plus anything rejected. Numbers are the risk here:
 * `Number("abc")` is NaN, and an unchecked NaN reaches Postgres as `invalid input syntax`, which
 * both fails the save and leaks the database's own error text to the user.
 */
export function validatePatch(patch: Record<string, string>): {
  clean: Record<string, string | number | null>;
  errors: string[];
} {
  const clean: Record<string, string | number | null> = {};
  const errors: string[] = [];

  for (const [key, rawValue] of Object.entries(patch)) {
    const label = FIELD_LABELS[key] ?? key;
    const value = (rawValue ?? "").trim();

    if (NUMERIC_FIELDS.has(key)) {
      if (value === "") {
        clean[key] = null;
        continue;
      }
      const n = Number(value.replace(/[, _]/g, ""));
      if (!Number.isFinite(n)) {
        errors.push(`${label} must be a number.`);
        continue;
      }
      if (key === "country") {
        if (!Number.isInteger(n) || !(n in PERMITTED_COUNTRIES)) {
          errors.push(
            `${label} must be one of: ${Object.entries(PERMITTED_COUNTRIES)
              .map(([code, name]) => `${name} (${code})`)
              .join(", ")}.`,
          );
          continue;
        }
      } else {
        if (n < 0) {
          errors.push(`${label} cannot be negative.`);
          continue;
        }
        if (n > MAX_MONEY) {
          errors.push(`${label} is implausibly large — enter a figure below S$${MAX_MONEY.toLocaleString()}.`);
          continue;
        }
      }
      clean[key] = n;
      continue;
    }

    if (key === "accountType") {
      clean[key] = value === "entity" ? "entity" : "individual";
      continue;
    }

    if (value.length > MAX_TEXT) {
      errors.push(`${label} is too long (limit ${MAX_TEXT} characters).`);
      continue;
    }
    clean[key] = value === "" ? null : value;
  }

  return { clean, errors };
}

export const STATUS_LABEL: Record<ApplicationStatus, string> = {
  draft: "draft",
  submitted: "submitted",
  in_review: "in review",
  approved: "approved",
  rejected: "rejected",
};

export const ACCREDITATION_LABEL: Record<AccreditationLevel, string> = {
  retail: "retail",
  accredited: "accredited",
  institutional: "institutional",
};
