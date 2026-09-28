import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ml_dsa65 } from "@noble/post-quantum/ml-dsa";
import { bytesToHex, hexToBytes, keccak256, toBytes } from "viem";
import { canonicalize, CanonicalizeError } from "./canonical.ts";
import { requestSignatureValid, signedRequest, verifierPublicKey, type ProtocolConfig } from "./protocol.ts";
import { assess, evidenceOf, type Received } from "./assess.ts";
import type { CorporateIdentityDocument, CredentialHeader } from "./protocol.ts";

// --- canonical JSON, against the protocol's own known-answer vectors ---

type Vector = { name: string; input: Record<string, unknown>; expected: { hex?: string; error?: string } };
const vectors: Vector[] = JSON.parse(readFileSync(new URL("./testdata/canonicalize.vectors.json", import.meta.url), "utf8")).vectors;

function inputOf(v: Vector): unknown {
  const i = v.input;
  if ("json" in i) return i.json;
  if (i.nonJsonable === "NaN") return NaN;
  if (i.nonJsonable === "Infinity") return Infinity;
  if (i.nonJsonable === "-Infinity") return -Infinity;
  if (i.synthesize === "cycle-self") {
    const o: Record<string, unknown> = {};
    o.self = o;
    return o;
  }
  if (i.synthesize === "depth") {
    let x: unknown = 0;
    for (let k = 0; k < (i.levels as number); ++k) x = [x];
    return x;
  }
  if (i.synthesize === "long-string") return "a".repeat(i.utf8Bytes as number);
  throw new Error(`unknown vector input in ${v.name}`);
}

test(`canonical JSON matches the protocol's ${vectors.length} known-answer vectors`, () => {
  for (const v of vectors) {
    const input = inputOf(v);
    if (v.expected.error) {
      assert.throws(() => canonicalize(input), (e: unknown) => e instanceof CanonicalizeError && e.code === v.expected.error, v.name);
    } else {
      assert.equal(Buffer.from(canonicalize(input)).toString("hex"), v.expected.hex, v.name);
    }
  }
});

// --- the Access Issuer's signed requests ---

const verifierSeed = new Uint8Array(32).fill(7);
const issuerKeys = ml_dsa65.keygen(new Uint8Array(32).fill(9));
const config: ProtocolConfig = {
  verifierUrl: "https://verifier.example",
  verifierDid: "did:example:access-issuer",
  verifierName: "Access Issuer",
  verifierSeed,
  inlineKey: false,
  issuerDid: "did:example:bank",
  issuerPublicKey: issuerKeys.publicKey,
  schemas: { officer: "schema:officer/v1", walletControl: "schema:wallet/v1", corporateIdentity: "schema:corporate/v1" },
  corporateIssuers: { "did:example:corp": "https://corp.example" },
  callbackUrl: "https://site.example/api/admission/callback",
};

test("a request is signed over its canonical form, and any change breaks the signature", () => {
  const r = signedRequest(config, "officer", 1_790_000_000);
  const pk = hexToBytes(verifierPublicKey(config));
  assert.ok(requestSignatureValid(r, pk));
  assert.equal(r.verifierPublicKey, undefined, "registry mode by default");
  assert.deepEqual(r.filter.issuers, { mode: "allow", list: ["did:example:bank"] });
  assert.equal(r.response.callbackUrl, config.callbackUrl);
  assert.equal(r.expiresAt - r.issuedAt, 300);
  assert.equal(requestSignatureValid({ ...r, response: { mode: "callback", callbackUrl: "https://attacker.example" } }, pk), false);
});

test("each request has its own identifier and challenge", () => {
  const a = signedRequest(config, "officer", 1);
  const b = signedRequest(config, "officer", 1);
  assert.notEqual(a.requestId, b.requestId);
  assert.notEqual(a.challenge, b.challenge);
});

// --- the assessment ---

const NOW = 1_790_000_000;
const OFFICER = "did:example:officer";
const CORP = "did:example:corp";
const WALLET = "0x323825Ea326cCF11d6635E2CA48E5836C8aE566d";
const cid = (s: string) => keccak256(toBytes(s));

function header(p: Partial<CredentialHeader>): CredentialHeader {
  return { v: 1, alg: "ML-DSA-65", hash: "RPO-256", iss: "did:example:bank", sub: OFFICER, iat: NOW - 86_400, exp: NOW + 365 * 86_400, cid: cid("x"), root: cid("root"), schema: "", ...p };
}

function received(h: CredentialHeader, claims: Record<string, unknown>, verdict: Partial<Received["verdict"]> = {}): Received {
  return {
    presentation: { v: 1, header: h, headerSig: "0x00", challenge: "0x00", disclosed: Object.entries(claims).map(([key, value]) => ({ key, value })) },
    verdict: { v: 1, decision: "GRANT", reason: "ok", checks: { corporateChainValid: true }, ...verdict },
  };
}

function corporate(claims: Record<string, unknown> = {}, h: Partial<CredentialHeader> = {}): CorporateIdentityDocument {
  const hdr = header({ sub: CORP, schema: "schema:corporate/v1", cid: cid("corporate identity"), ...h });
  const headerSig = bytesToHex(ml_dsa65.sign(issuerKeys.secretKey, canonicalize(hdr)));
  return {
    issuerDid: "did:example:bank",
    subjectDid: CORP,
    credential: { header: hdr, headerSig, claims: { legalName: "Test Institution One", status: "active", jurisdiction: "LU", investorClass: "institutional", ceoOfficerDid: OFFICER, ...claims } },
  };
}

const officer = (o: Partial<CredentialHeader> = {}, claims: Record<string, unknown> = {}, v: Partial<Received["verdict"]> = {}) =>
  received(header({ schema: "schema:officer/v1", cid: cid("officer"), ...o }), { corporationDid: CORP, role: "CEO", ...claims }, v);
const wallet = (o: Partial<CredentialHeader> = {}, claims: Record<string, unknown> = {}) =>
  received(header({ schema: "schema:wallet/v1", cid: cid("wallet"), ...o }), { walletAddress: WALLET, chain: "eip155:1", addressType: "eoa", ...claims });

test("a good officer admission becomes one attestation and one registry grant", () => {
  const a = assess(config, officer(), wallet(), corporate(), 84532, NOW);
  assert.ok(a.ok, JSON.stringify(!a.ok && a.problems));
  if (!a.ok) return;
  assert.equal(a.attestation.account, WALLET);
  assert.equal(a.attestation.primaryCredential, cid("corporate identity"));
  assert.equal(a.attestation.screeningCredential, cid("corporate identity"), "the screening rides inside");
  assert.equal(a.attestation.walletCredential, cid("wallet"));
  assert.equal(a.attestation.authorityCredential, cid("officer"));
  assert.equal(a.attestation.jurisdiction, "0x4c55");
  assert.equal(a.attestation.investorClass, 2);
  assert.equal(a.attestation.checks, 1 | 2 | 4 | 16);
  assert.equal(a.attestation.screenedAt, NOW - 86_400, "screened at issuance");
  assert.equal(a.registry.jurisdiction, 442);
  assert.equal(a.registry.credentialRef, cid("corporate identity"));
  assert.equal(a.registry.commitment, a.attestation.evidence);
  assert.equal(a.summary.corporation, "Test Institution One");
});

test("an entity with no investor class is institutional by policy (ADR 0053)", () => {
  const doc = corporate();
  delete doc.credential.claims.investorClass;
  const a = assess(config, officer(), wallet(), doc, 84532, NOW);
  assert.ok(a.ok, JSON.stringify(!a.ok && a.problems));
  if (a.ok) assert.equal(a.attestation.investorClass, 2);
});

test("the grant ends with the first credential to expire", () => {
  const a = assess(config, officer({ exp: NOW + 30 * 86_400 }), wallet(), corporate(), 84532, NOW);
  assert.ok(a.ok);
  if (a.ok) assert.equal(a.attestation.credentialExpiry, NOW + 30 * 86_400);
});

test("an ordinary wallet attested on any EVM chain is accepted; a contract wallet only on this one", () => {
  assert.ok(assess(config, officer(), wallet({}, { chain: "eip155:137" }), corporate(), 84532, NOW).ok);
  const elsewhere = assess(config, officer(), wallet({}, { addressType: "smart_contract", chain: "eip155:1" }), corporate(), 84532, NOW);
  assert.ok(!elsewhere.ok && elsewhere.problems.some((p) => /contract wallet attested on eip155:1/.test(p)));
  const here = assess(config, officer(), wallet({}, { addressType: "smart_contract", chain: "eip155:84532" }), corporate(), 84532, NOW);
  assert.ok(here.ok && here.registry.flags.contractAccount);
});

const refusals: Array<[string, () => ReturnType<typeof assess>, RegExp]> = [
  ["a refused officer presentation", () => assess(config, officer({}, {}, { decision: "DENY", reason: "revoked" }), wallet(), corporate(), 84532, NOW), /officer's presentation was refused/],
  ["no composition by the verifier", () => assess(config, officer({}, {}, { checks: { corporateChainValid: false } }), wallet(), corporate(), 84532, NOW), /did not confirm the officer/],
  ["an officer credential from another issuer", () => assess(config, officer({ iss: "did:example:other" }), wallet(), corporate(), 84532, NOW), /officer credential was not issued by the configured issuer/],
  ["a wallet bound to someone else", () => assess(config, officer(), wallet({ sub: "did:example:someone-else" }), corporate(), 84532, NOW), /bound to someone other than the presenting officer/],
  ["a wallet credential from another issuer", () => assess(config, officer(), wallet({ iss: "did:example:other" }), corporate(), 84532, NOW), /wallet credential was not issued/],
  ["a corporation that is not active", () => assess(config, officer(), wallet(), corporate({ status: "suspended" }), 84532, NOW), /not active \(suspended\)/],
  ["an officer not on the roster", () => assess(config, officer(), wallet(), corporate({ ceoOfficerDid: "did:example:another" }), 84532, NOW), /does not name the officer as CEO/],
  ["another corporation's identity", () => assess(config, officer({}, { corporationDid: "did:example:other-corp" }), wallet(), corporate(), 84532, NOW), /not the corporation the officer acts for/],
  ["a jurisdiction outside the allowlist", () => assess(config, officer(), wallet(), corporate({ jurisdiction: "US" }), 84532, NOW), /outside the pool's allowlist \(US\)/],
  ["an unknown investor class", () => assess(config, officer(), wallet(), corporate({ investorClass: "family office" }), 84532, NOW), /no recognised investor class/],
  ["an expired credential", () => assess(config, officer(), wallet({ exp: NOW }), corporate(), 84532, NOW), /has expired/],
];
for (const [name, run, pattern] of refusals) {
  test(`refused: ${name}`, () => {
    const a = run();
    assert.ok(!a.ok, "should be refused");
    if (!a.ok) assert.ok(a.problems.some((p) => pattern.test(p)), a.problems.join("; "));
  });
}

test("refused: a corporate identity whose signature does not verify against the pinned key", () => {
  const doc = corporate();
  doc.credential.claims.jurisdiction = "DE"; // claims are outside the header, so this alone still verifies
  assert.ok(assess(config, officer(), wallet(), doc, 84532, NOW).ok);
  doc.credential.header = { ...doc.credential.header, exp: doc.credential.header.exp + 1 };
  const a = assess(config, officer(), wallet(), doc, 84532, NOW);
  assert.ok(!a.ok && a.problems.some((p) => /signature does not verify/.test(p)));
});

test("the evidence hash changes with anything the admission rests on", () => {
  const e1 = evidenceOf(officer(), wallet(), corporate());
  const e2 = evidenceOf(officer(), wallet({}, { chain: "eip155:137" }), corporate());
  assert.notEqual(e1, e2);
  assert.match(e1, /^0x[0-9a-f]{64}$/);
});

// --- the bank's routes (ADR 0054) ---

import { assessBankAdmission, type BankAdmissionInput } from "./assess.ts";

const bankInput = (p: Partial<BankAdmissionInput> = {}, record: Partial<BankAdmissionInput["record"]> = {}, wallet: Partial<BankAdmissionInput["wallet"]> = {}): BankAdmissionInput => ({
  route: "custodied",
  record: { kycReference: "KYC-1", legalName: "Test Institution One", jurisdiction: "LU", status: "active", screenedAt: NOW - 3600, ...record },
  corporateIdentity: { credentialId: cid("corporate identity"), subjectDid: CORP, schema: "schema:corporate/v1", issuedAt: NOW - 300 * 86_400, expiresAt: NOW + 60 * 86_400 },
  wallet: { credentialId: cid("wallet"), address: WALLET, addressType: "smart_contract", chain: "eip155:84532", ...wallet },
  instructionRef: "INS-1",
  reviewedBy: "staff@bank.example",
  ...p,
});

test("a custodied admission rests on the bank's record and the credential identifiers", () => {
  const a = assessBankAdmission(config, bankInput(), 84532, NOW);
  assert.ok(a.ok, JSON.stringify(!a.ok && a.problems));
  if (!a.ok) return;
  assert.equal(a.attestation.primaryCredential, cid("corporate identity"));
  assert.equal(a.attestation.walletCredential, cid("wallet"));
  assert.equal(a.attestation.authorityCredential, `0x${"00".repeat(32)}`, "no officer: the bank's KYB establishes authority");
  assert.equal(a.attestation.screenedAt, NOW - 3600, "the bank's latest screening, not the credential's issue date");
  assert.equal(a.attestation.investorClass, 2, "institutional by policy");
  assert.ok(a.registry.flags.contractAccount);
  assert.equal(a.attestation.credentialExpiry, NOW + 60 * 86_400);
});

test("a self-custody admission of an ordinary wallet attested on another EVM chain is accepted", () => {
  assert.ok(assessBankAdmission(config, bankInput({ route: "self-custody" }, {}, { addressType: "eoa", chain: "eip155:1" }), 84532, NOW).ok);
});

const bankRefusals: Array<[string, BankAdmissionInput, RegExp]> = [
  ["a custodied admission of an ordinary wallet", bankInput({}, {}, { addressType: "eoa" }), /for the custody account/],
  ["a contract wallet attested on another chain", bankInput({ route: "self-custody" }, {}, { chain: "eip155:1" }), /contract wallet attested on eip155:1/],
  ["a client the bank records as suspended", bankInput({}, { status: "suspended" }), /records the client as suspended/],
  ["a jurisdiction outside the allowlist", bankInput({}, { jurisdiction: "US" }), /outside the pool's allowlist \(US\)/],
  ["no instruction reference", bankInput({ instructionRef: " " }), /instruction reference is missing/],
  ["an expired corporate identity", bankInput({ corporateIdentity: { credentialId: cid("c"), subjectDid: CORP, schema: "schema:corporate/v1", issuedAt: 0, expiresAt: NOW } }), /has expired/],
  ["a credential of another schema", bankInput({ corporateIdentity: { credentialId: cid("c"), subjectDid: CORP, schema: "schema:passport/v1", issuedAt: 0, expiresAt: NOW + 1000 } }), /not a corporate identity/],
];
for (const [name, input, pattern] of bankRefusals) {
  test(`bank route refused: ${name}`, () => {
    const a = assessBankAdmission(config, input, 84532, NOW);
    assert.ok(!a.ok && a.problems.some((p) => pattern.test(p)), JSON.stringify(a));
  });
}

// --- the bank's typed data ---

import { normaliseTypedData } from "./bank.ts";
import { hashTypedData } from "viem";

test("the bank's decimal-string integers are signed as the numbers they are", () => {
  const td = {
    types: { EIP712Domain: [], Attestation: [{ name: "issuedAt", type: "uint64" }, { name: "who", type: "string" }] },
    primaryType: "Attestation",
    domain: { name: "Bank", version: "1", chainId: "84532" },
    message: { issuedAt: "1790355225", who: "123" },
  };
  const n = normaliseTypedData(td);
  assert.equal(n.domain.chainId, 84532);
  assert.equal(n.message.issuedAt, 1790355225);
  assert.equal(n.message.who, "123", "a string field stays a string");
  assert.equal(td.domain.chainId, "84532", "the original is not changed");
  const { EIP712Domain: _d, ...types } = n.types;
  const expected = hashTypedData({ domain: { name: "Bank", version: "1", chainId: 84532 }, types, primaryType: "Attestation", message: { issuedAt: 1790355225n, who: "123" } });
  assert.equal(hashTypedData({ domain: n.domain, types, primaryType: "Attestation", message: n.message }), expected);
});
