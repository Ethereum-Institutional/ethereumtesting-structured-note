import "server-only";
import { addresses } from "../chain";
import { driverName, ensureSchema, insertApplications, hasApplications } from "./index";
import { assessAccreditation, type Application, type AccountType } from "./types";

/**
 * Seeds the platform store from the deployment manifest, so the admin queue is a book of
 * business rather than an empty table before anyone has signed up.
 *
 * Every seeded file maps to a wallet that already exists on the chain and is already an approved
 * holder, which is why they appear as approved rather than pending. Live sign-ups from the event
 * arrive alongside them as new files in review.
 *
 * Idempotent: inserts only what is missing. All applicant details are fictional.
 */

const now = () => new Date().toISOString();

function blank(
  o: Partial<Application> & Pick<Application, "id" | "reference" | "applicantName">,
): Application {
  const base: Application = {
    id: o.id,
    reference: o.reference,
    userId: null,
    applicantName: o.applicantName,
    wallet: null as any,
    status: "approved",
    submittedAt: "2026-07-02",
    accountType: "individual",
    legalName: null,
    dob: null,
    nationality: null,
    residentialAddress: null,
    passportNumber: null,
    taxId: null,
    entityName: null,
    entityForm: null,
    registrationNumber: null,
    incorporationCountry: null,
    registeredOffice: null,
    repName: null,
    repPassportNumber: null,
    country: null,
    phone: null,
    sourceOfFunds: "Investment portfolio",
    annualIncome: null,
    netFinancialAssets: null,
    entityNetAssets: null,
    accreditationLevel: "retail",
    accreditationBasis: null,
    sanctionsResult: "No match — cleared",
    pepResult: "No match — cleared",
    adverseMediaResult: "No findings",
    allocation: null,
    startingCash: null,
    reviewerNotes: null,
    rejectionReason: null,
    onchainIdentity: null,
    claimDigest: null,
    approvedAt: "2026-07-03",
    approvedBy: "compliance@meridiancustody.example",
    updatedAt: now(),
    ...o,
  } as Application;

  const assessed = assessAccreditation(base);
  base.accreditationLevel = assessed.level;
  base.accreditationBasis = assessed.basis;
  return base;
}

/**
 * Memoised per process: once the table is known to hold rows, later requests skip the check
 * entirely. Every page load was previously pulling the whole applications table just to decide
 * there was nothing to seed — a full round trip and scan against a database in another region.
 */
let seeded = false;

export async function seedIfEmpty(): Promise<void> {
  if (seeded) return;
  await ensureSchema();
  if (await hasApplications()) {
    seeded = true;
    return;
  }

  const a = addresses();
  const rows: Application[] = [];
  const inv = (n: string) => a.investors?.find((i) => i.name === n);

  // The fund's treasury appears as an account like any other, because that is what it is on-chain:
  // a verified holder, subject to the same transfer rules, whose balance is the undistributed
  // inventory allocations come out of.
  if (a.treasury?.account) {
    rows.push(
      blank({
        id: "app-treasury",
        reference: "APP-2026-0001",
        applicantName: a.treasury.name,
        wallet: a.treasury.account,
        accountType: "entity",
        entityName: "APAC Money Market Fund",
        entityForm: "Licensed fund manager",
        registrationNumber: "202100001T",
        incorporationCountry: "Singapore",
        registeredOffice: "Registered office of the fund, Singapore",
        repName: "Fund administrator",
        repPassportNumber: "n/a — fund vehicle",
        country: a.treasury.country,
        entityNetAssets: 500_000_000,
        sourceOfFunds: "Subscriptions to the fund",
        onchainIdentity: a.treasury.identity,
        reviewerNotes:
          "The fund's own treasury. Holds undistributed units; investor allocations are transfers out of this account.",
      }),
    );
  }

  // Direct, self-custodied holders.
  const direct: Array<[string, string, number, string, string, string, number, number, string]> = [
    ["Alice", "APP-2026-0102", 702, "Singapore", "Alice Mei Tan", "1985-06-24", 2_400_000, 420_000, "500000"],
    ["Bob", "APP-2026-0118", 344, "Hong Kong", "Bob Kar-Wai Leung", "1991-11-02", 1_150_000, 260_000, "150000"],
    ["Carol", "APP-2026-0126", 392, "Japan", "Carol Aiko Mori", "1976-01-19", 3_900_000, 610_000, "150000"],
  ];
  for (const [name, ref, country, nat, legal, dob, assets, income, alloc] of direct) {
    const i = inv(name);
    if (!i) continue;
    rows.push(
      blank({
        id: `app-${name.toLowerCase()}`,
        reference: ref,
        applicantName: name,
        wallet: i.wallet,
        accountType: "individual",
        country,
        nationality: nat,
        legalName: legal,
        dob,
        taxId: `${country}-${ref.slice(-4)}-A`,
        residentialAddress: `Registered address on file, ${nat}`,
        passportNumber: `E${ref.slice(-4)}8821`,
        netFinancialAssets: assets,
        annualIncome: income,
        allocation: alloc,
        onchainIdentity: i.identity,
        reviewerNotes: "Direct holder, self-custodied.",
      }),
    );
  }

  // Entities held under the custody mandate.
  const FORMS = ["Licensed fund manager", "Family office", "Private limited company"];
  (a.custodyClients ?? []).forEach((c, idx) => {
    rows.push(
      blank({
        id: `app-${c.ref.toLowerCase()}`,
        reference: `APP-2026-0${204 + idx}`,
        applicantName: c.name,
        wallet: c.account,
        accountType: "entity" as AccountType,
        entityName: `${c.name} Pte Ltd`,
        entityForm: FORMS[idx % FORMS.length],
        registrationNumber: `2019${String(10000 + idx * 137)}K`,
        incorporationCountry: c.country === 702 ? "Singapore" : c.country === 344 ? "Hong Kong" : "Japan",
        registeredOffice: "Registered office on file",
        repName: "Authorised representative on file",
        repPassportNumber: `K${String(3000000 + idx * 4441)}`,
        country: c.country,
        entityNetAssets: c.professional ? 45_000_000 : 12_500_000,
        sourceOfFunds: "Client subscriptions under custody mandate",
        onchainIdentity: c.identity,
        reviewerNotes: `Held under the ${c.custodian} mandate in a segregated account.`,
      }),
    );
  });

  // A corporate file complete but awaiting sign-off, so the queue has something actionable
  // before any live sign-ups arrive.
  for (const c of a.custodyPending ?? []) {
    rows.push(
      blank({
        id: `app-${c.ref.toLowerCase()}`,
        reference: "APP-2026-0431",
        applicantName: c.name,
        wallet: c.account,
        status: "in_review",
        submittedAt: "2026-08-15",
        accountType: "entity",
        entityName: "Prospect Capital Partners Pte Ltd",
        entityForm: "Private limited company",
        registrationNumber: "202244881N",
        incorporationCountry: "Singapore",
        registeredOffice: "Level 18, 12 Marina Boulevard, Singapore 018981",
        repName: "Authorised representative on file",
        repPassportNumber: "K4820119",
        country: 702,
        entityNetAssets: 26_000_000,
        sourceOfFunds: "Client subscriptions under custody mandate",
        allocation: "60000",
        reviewerNotes: "Corporate file complete; awaiting sign-off before allocation.",
        approvedAt: null,
        approvedBy: null,
      }),
    );
  }

  await insertApplications(rows);
  seeded = true;
}

export { driverName };
