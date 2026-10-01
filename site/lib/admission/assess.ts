import { createHash } from "node:crypto";
import { getAddress, isAddress, keccak256, toBytes, type Address, type Hex } from "viem";
import { canonicalString } from "./canonical.ts";
import {
  headerSignatureValid,
  type CorporateIdentityDocument,
  type Presentation,
  type ProtocolConfig,
  type Verdict,
} from "./protocol.ts";

/**
 * The Access Issuer's assessment of an entity's admission: the officer's presentation, the
 * wallet-control presentation, and the corporation's corporate identity, each already given a
 * verdict or fetched, become one pool attestation and one registry grant, or a list of what is
 * wrong (ADRs 0033, 0042 to 0046, 0049, 0050, 0052).
 *
 * Pure: no network, no clock of its own, so every rule is tested. Credential signatures are the
 * hosted verifier's (ADR 0047), except the corporate identity's header signature, checked here
 * against the pinned issuer key because the corporate identity reaches us by discovery.
 */

export type Received = { presentation: Presentation; verdict: Verdict };

export type Attestation = {
  account: Address;
  path: 1; // entity
  primaryCredential: Hex;
  screeningCredential: Hex;
  walletCredential: Hex;
  authorityCredential: Hex;
  primarySchema: Hex;
  screeningSchema: Hex;
  checks: number;
  jurisdiction: Hex;
  investorClass: number;
  screenedAt: number;
  credentialExpiry: number;
  evidence: Hex;
};

export type RegistryGrant = {
  account: Address;
  flags: { professional: boolean; contractAccount: boolean };
  jurisdiction: number;
  expiresAt: number;
  credentialRef: Hex;
  commitment: Hex;
};

export type Summary = {
  corporation: string;
  corporationDid: string;
  officerDid: string;
  role: string;
  wallet: Address;
  walletType: string;
  jurisdiction: string;
  investorClass: string;
  expiresAt: number;
};

export type Assessment =
  | { ok: true; attestation: Attestation; registry: RegistryGrant; summary: Summary }
  | { ok: false; problems: string[] };

export const CHECK_WALLET_CONTROL = 1;
export const CHECK_NOT_EXPIRED = 2;
export const CHECK_ENTITY_ACTIVE = 4;
export const CHECK_SANCTIONS_CLEAN = 16;

/** The screening schema's investor classes, in its order (ADR 0033). */
export const INVESTOR_CLASSES = ["sophisticated", "professional", "institutional", "retail"];
/** The pool gate's screening maximum age (script/01_DeployVenue.s.sol, SCREENING_MAX_AGE). */
export const SCREENING_MAX_AGE = 30 * 86_400;
const INSTITUTIONAL = 2;

/** ISO 3166-1 numeric for the pool's allowlist, as the Identity Registry records jurisdiction. */
export const NUMERIC: Record<string, number> = {
  AT: 40, BE: 56, BG: 100, HR: 191, CY: 196, CZ: 203, DK: 208, EE: 233, FI: 246, FR: 250, DE: 276, GR: 300,
  HU: 348, IE: 372, IT: 380, LV: 428, LT: 440, LU: 442, MT: 470, NL: 528, PL: 616, PT: 620, RO: 642, SK: 703,
  SI: 705, ES: 724, SE: 752, IS: 352, LI: 438, NO: 578, CH: 756, GB: 826,
};

const REGISTRY_VALIDITY = 180 * 86_400;
const ROSTER: Record<string, string> = { CEO: "ceoOfficerDid", COO: "cooOfficerDid", CFO: "cfoOfficerDid" };

const bytes32 = (v: string): Hex | null => (/^0x[0-9a-fA-F]{64}$/.test(v) ? (v.toLowerCase() as Hex) : null);

function disclosed(r: Received): Record<string, unknown> {
  return Object.fromEntries(r.presentation.disclosed.map((d) => [d.key, d.value]));
}

/** The hash of everything the admission rests on, recorded in both grants. */
export function evidenceOf(officer: Received, wallet: Received, corporate: CorporateIdentityDocument): Hex {
  const record = canonicalString({ corporateIdentity: corporate, officer, wallet });
  return `0x${createHash("sha256").update(record).digest("hex")}`;
}

export function assess(
  c: Pick<ProtocolConfig, "issuerDid" | "issuerPublicKey" | "schemas">,
  officer: Received,
  wallet: Received,
  corporate: CorporateIdentityDocument,
  chainId: number,
  nowSec: number,
): Assessment {
  const problems: string[] = [];
  const fail = (m: string) => problems.push(m);

  // The officer: a granted presentation of a bank-issued officer credential, composed by the
  // verifier with the corporation's corporate identity (ADRs 0046, 0052).
  const oh = officer.presentation.header;
  if (officer.verdict.decision !== "GRANT") fail(`the officer's presentation was refused: ${officer.verdict.reason}`);
  if (officer.verdict.checks.corporateChainValid !== true) fail("the verifier did not confirm the officer against the corporate identity");
  if (oh.schema !== c.schemas.officer) fail(`the first presentation is not an officer credential (${oh.schema})`);
  if (oh.iss !== c.issuerDid) fail(`the officer credential was not issued by the configured issuer (${oh.iss})`);
  const od = disclosed(officer);
  const corporationDid = typeof od.corporationDid === "string" ? od.corporationDid : "";
  const role = typeof od.role === "string" ? od.role : "";
  if (!corporationDid) fail("the officer did not disclose the corporation");

  // The wallet: a granted wallet-control credential, issued to the same officer (ADR 0050).
  const wh = wallet.presentation.header;
  if (wallet.verdict.decision !== "GRANT") fail(`the wallet presentation was refused: ${wallet.verdict.reason}`);
  if (wh.schema !== c.schemas.walletControl) fail(`the second presentation is not a wallet-control credential (${wh.schema})`);
  if (wh.iss !== c.issuerDid) fail(`the wallet credential was not issued by the configured issuer (${wh.iss})`);
  if (wh.sub !== oh.sub) fail("the wallet credential is bound to someone other than the presenting officer");
  const wd = disclosed(wallet);
  const address = typeof wd.walletAddress === "string" && isAddress(wd.walletAddress) ? getAddress(wd.walletAddress) : null;
  if (!address) fail("the wallet credential discloses no valid address");
  const chain = typeof wd.chain === "string" ? wd.chain : "";
  const walletType = typeof wd.addressType === "string" ? wd.addressType : "";
  if (!chain.startsWith("eip155:")) fail(`the wallet was attested on a chain that is not EVM (${chain})`);
  if (walletType !== "eoa" && walletType !== "smart_contract") fail(`unknown wallet type (${walletType})`);
  // An ordinary wallet's control holds on every EVM chain; a contract wallet's only where it was
  // checked (ADR 0042).
  if (walletType === "smart_contract" && chain !== `eip155:${chainId}`) {
    fail(`a contract wallet attested on ${chain} cannot be admitted on eip155:${chainId}`);
  }

  // The corporate identity: the corporation the officer acts for, issued by the configured issuer,
  // authentic against the pinned key, active, and naming the officer at the role claimed.
  const cc = corporate.credential;
  const ch = cc.header;
  if (ch.iss !== c.issuerDid || corporate.issuerDid !== c.issuerDid) fail(`the corporate identity was not issued by the configured issuer (${ch.iss})`);
  if (ch.schema !== c.schemas.corporateIdentity) fail(`the corporate identity has the wrong schema (${ch.schema})`);
  if (corporationDid && (ch.sub !== corporationDid || corporate.subjectDid !== corporationDid)) {
    fail("the corporate identity is not the corporation the officer acts for");
  }
  if (!headerSignatureValid(ch, cc.headerSig, c.issuerPublicKey)) fail("the corporate identity's signature does not verify against the pinned issuer key");
  if (cc.claims.status !== "active") fail(`the corporation is not active (${String(cc.claims.status)})`);
  const slot = ROSTER[role];
  if (!slot || cc.claims[slot] !== oh.sub) fail(`the corporate identity does not name the officer as ${role || "an officer"}`);
  const jurisdiction = typeof cc.claims.jurisdiction === "string" ? cc.claims.jurisdiction : "";
  if (!(jurisdiction in NUMERIC)) fail(`the corporation's jurisdiction is outside the pool's allowlist (${jurisdiction || "none"})`);
  // Institutional by policy when the credential carries no class; the bank's KYB classifies its
  // clients (ADR 0053). A class it does carry is used, and must be one the schema knows.
  const investorClass = cc.claims.investorClass == null ? INSTITUTIONAL : INVESTOR_CLASSES.indexOf(String(cc.claims.investorClass));
  if (investorClass < 0) fail(`the corporate identity carries no recognised investor class (${String(cc.claims.investorClass)})`);

  // Identifiers, and the lifetime: the grant ends with the first credential to expire (ADR 0052).
  const primary = bytes32(ch.cid);
  const walletCid = bytes32(wh.cid);
  const officerCid = bytes32(oh.cid);
  if (!primary || !walletCid || !officerCid) fail("a credential identifier is not 32 bytes");
  const expiresAt = Math.min(ch.exp, oh.exp, wh.exp);
  if (!(expiresAt > nowSec)) fail("a credential has expired");

  if (problems.length || !address || !primary || !walletCid || !officerCid) return { ok: false, problems };

  const schema = keccak256(toBytes(c.schemas.corporateIdentity));
  const evidence = evidenceOf(officer, wallet, corporate);
  const attestation: Attestation = {
    account: address,
    path: 1,
    primaryCredential: primary,
    screeningCredential: primary, // the screening rides inside the corporate identity (ADR 0033)
    walletCredential: walletCid,
    authorityCredential: officerCid, // the officer who presented (ADR 0049)
    primarySchema: schema,
    screeningSchema: schema,
    // Wallet control: granted by the verifier and bound to the officer above. Not expired and
    // active: read from the corporate identity. Sanctions: the issuer does not issue a corporate
    // identity to an entity it has not screened, so the screen is its issuance (ADR 0033).
    checks: CHECK_WALLET_CONTROL | CHECK_NOT_EXPIRED | CHECK_ENTITY_ACTIVE | CHECK_SANCTIONS_CLEAN,
    jurisdiction: `0x${Buffer.from(jurisdiction, "latin1").toString("hex")}` as Hex,
    investorClass,
    screenedAt: ch.iat,
    credentialExpiry: expiresAt,
    evidence,
  };
  const registry: RegistryGrant = {
    account: address,
    flags: { professional: investorClass === 1 || investorClass === 2, contractAccount: walletType === "smart_contract" },
    jurisdiction: NUMERIC[jurisdiction],
    expiresAt: Math.min(expiresAt, nowSec + REGISTRY_VALIDITY),
    credentialRef: primary,
    commitment: evidence,
  };
  const summary: Summary = {
    corporation: String(cc.claims.legalName ?? corporationDid),
    corporationDid,
    officerDid: oh.sub,
    role,
    wallet: address,
    walletType,
    jurisdiction,
    investorClass: INVESTOR_CLASSES[investorClass],
    expiresAt,
  };
  return { ok: true, attestation, registry, summary };
}

// ---------------------------------------------------------------------------------------------
// The bank's routes (ADR 0054): custodied, and self-custody through the bank
// ---------------------------------------------------------------------------------------------

/** What the bank states from its own KYB file about the client. */
export type BankRecord = {
  kycReference: string;
  legalName: string;
  jurisdiction: string; // ISO 3166-1 alpha-2
  status: string; // "active"
  screenedAt: number; // the bank's latest sanctions screening, Unix seconds
  investorClass?: string; // institutional by policy when absent (ADR 0053)
};

export type BankAdmissionInput = {
  route: "custodied" | "self-custody";
  record: BankRecord;
  corporateIdentity: { credentialId: string; subjectDid: string; schema: string; issuedAt: number; expiresAt: number };
  wallet: { credentialId: string; address: string; addressType: "eoa" | "smart_contract"; chain: string };
  /** The client's instruction or request, and who reviewed it at the bank. */
  instructionRef: string;
  reviewedBy: string;
};

export function bankEvidenceOf(i: BankAdmissionInput): Hex {
  return `0x${createHash("sha256").update(canonicalString(i)).digest("hex")}`;
}

/**
 * The bank's statement becomes the same two grants as the holder-wallet route. The credential
 * identifiers make the grant revocable; the jurisdiction, status and screening are the bank's, from
 * its records. The gate still checks the issuer is active, nothing is revoked, and the policy.
 */
export function assessBankAdmission(
  c: Pick<ProtocolConfig, "schemas">,
  i: BankAdmissionInput,
  chainId: number,
  nowSec: number,
): Assessment {
  const problems: string[] = [];
  const fail = (m: string) => problems.push(m);
  const r = i.record;

  if (i.corporateIdentity.schema !== c.schemas.corporateIdentity) fail(`the credential found is not a corporate identity (${i.corporateIdentity.schema})`);
  if (r.status !== "active") fail(`the bank records the client as ${r.status || "not active"}`);
  if (!(r.jurisdiction in NUMERIC)) fail(`the client's jurisdiction is outside the pool's allowlist (${r.jurisdiction || "none"})`);
  const investorClass = r.investorClass == null || r.investorClass === "" ? INSTITUTIONAL : INVESTOR_CLASSES.indexOf(r.investorClass);
  if (investorClass < 0) fail(`unknown investor class (${r.investorClass})`);
  if (!(r.screenedAt <= nowSec)) fail("the screening date is in the future");
  if (nowSec - r.screenedAt > SCREENING_MAX_AGE) fail("the client's screening is older than 30 days: re-screen the client first");
  if (!i.instructionRef.trim()) fail("the client's instruction reference is missing");
  const address = isAddress(i.wallet.address) ? getAddress(i.wallet.address) : null;
  if (!address) fail("the wallet address is not valid");
  if (i.wallet.addressType === "smart_contract" && i.wallet.chain !== `eip155:${chainId}`) {
    fail(`a contract wallet attested on ${i.wallet.chain} cannot be admitted on eip155:${chainId}`);
  }
  if (i.route === "custodied" && i.wallet.addressType !== "smart_contract") fail("a custodied admission is for the custody account, a contract wallet");
  const primary = bytes32(i.corporateIdentity.credentialId);
  const walletCid = bytes32(i.wallet.credentialId);
  if (!primary || !walletCid) fail("a credential identifier is not 32 bytes");
  if (!(i.corporateIdentity.expiresAt > nowSec)) fail("the corporate identity has expired");

  if (problems.length || !address || !primary || !walletCid) return { ok: false, problems };

  const schema = keccak256(toBytes(c.schemas.corporateIdentity));
  const evidence = bankEvidenceOf(i);
  const expiresAt = i.corporateIdentity.expiresAt;
  const attestation: Attestation = {
    account: address,
    path: 1,
    primaryCredential: primary,
    screeningCredential: primary,
    walletCredential: walletCid,
    authorityCredential: `0x${"00".repeat(32)}` as Hex, // the bank's KYB establishes who may act (ADR 0054)
    primarySchema: schema,
    screeningSchema: schema,
    checks: CHECK_WALLET_CONTROL | CHECK_NOT_EXPIRED | CHECK_ENTITY_ACTIVE | CHECK_SANCTIONS_CLEAN,
    jurisdiction: `0x${Buffer.from(r.jurisdiction, "latin1").toString("hex")}` as Hex,
    investorClass,
    screenedAt: r.screenedAt,
    credentialExpiry: expiresAt,
    evidence,
  };
  const registry: RegistryGrant = {
    account: address,
    flags: { professional: investorClass === 1 || investorClass === 2, contractAccount: i.wallet.addressType === "smart_contract" },
    jurisdiction: NUMERIC[r.jurisdiction],
    expiresAt: Math.min(expiresAt, nowSec + REGISTRY_VALIDITY),
    credentialRef: primary,
    commitment: evidence,
  };
  const summary: Summary = {
    corporation: r.legalName,
    corporationDid: i.corporateIdentity.subjectDid,
    officerDid: "",
    role: i.route,
    wallet: address,
    walletType: i.wallet.addressType,
    jurisdiction: r.jurisdiction,
    investorClass: INVESTOR_CLASSES[investorClass],
    expiresAt,
  };
  return { ok: true, attestation, registry, summary };
}
