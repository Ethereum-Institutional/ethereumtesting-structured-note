/**
 * The admission flow end to end, against the local chain (ADRs 0045 to 0052).
 *
 * The site's own service code runs unchanged. Two things are played here: the protocol's hosted
 * verifier and the corporation's discovery endpoint (a stand-in HTTP server with a test issuer
 * key), and the holder wallet, which answers each signed request with a presentation. The grants
 * are written to the local deployment and read back.
 *
 *   ../ops/reset.sh && npm run test:admission
 */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ml_dsa65 } from "@noble/post-quantum/ml-dsa";
import { bytesToHex, createPublicClient, getAddress, hashTypedData, http, keccak256, parseAbi, toBytes, verifyTypedData, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { canonicalize } from "../lib/admission/canonical.ts";

const REPO = join(import.meta.dirname, "..", "..");
const MANIFEST = join(REPO, "ops", "addresses.json");
const RPC = process.env.RPC_URL ?? "http://127.0.0.1:8545";
const ISSUER = "did:example:credential-issuer"; // the local stack's configured issuer
const CORP = "did:example:corporation";
const OFFICER = "did:example:officer";
const PORT = 4011;
const NOW = Math.floor(Date.now() / 1000);
const WALLET = getAddress(`0x${keccak256(toBytes(`admission wallet ${Date.now()}`)).slice(26)}`);
const cid = (s: string) => keccak256(toBytes(`${s}/${NOW}`));

const issuerKeys = ml_dsa65.keygen(new Uint8Array(32).fill(21));
const SCHEMAS = { officer: "schema:corporate-officer/v1", walletControl: "schema:wallet-control-eth/v1", corporateIdentity: "schema:corporate-identity/v1" };

// --- the stand-in verifier and discovery endpoint ---

const lodged = new Map<string, unknown>();
const challenges = new Map<string, unknown>();
function corporateIdentity() {
  const header = { v: 1, alg: "ML-DSA-65", hash: "RPO-256", iss: ISSUER, sub: CORP, iat: NOW - 86_400, exp: NOW + 365 * 86_400, cid: cid("corporate identity"), root: cid("root"), schema: SCHEMAS.corporateIdentity };
  return {
    issuerDid: ISSUER,
    subjectDid: CORP,
    credential: {
      header,
      headerSig: bytesToHex(ml_dsa65.sign(issuerKeys.secretKey, canonicalize(header))),
      claims: { legalName: "Test Institution One", status: "active", jurisdiction: "LU", investorClass: "institutional", ceoOfficerDid: OFFICER, notExpired: true },
    },
  };
}
const server = createServer(async (req, res) => {
  let body = "";
  for await (const chunk of req) body += chunk;
  const send = (code: number, v: unknown) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(v)); };
  if (req.method === "POST" && req.url === "/v1/verifier-request") {
    const { request } = JSON.parse(body);
    lodged.set(request.requestId, request);
    return send(200, { v: 1, requestId: request.requestId });
  }
  if (req.method === "POST" && req.url === "/v1/verify") {
    const { presentation } = JSON.parse(body);
    const officer = presentation.header.schema === SCHEMAS.officer;
    return send(200, {
      v: 1, decision: "GRANT", reason: "all checks passed", ms: 1,
      checks: { headerSignature: true, corporateChainValid: officer ? true : null },
      disclosed: Object.fromEntries(presentation.disclosed.map((d: any) => [d.key, d.value])),
    });
  }
  if (req.method === "GET" && req.url === "/v1/issuer/corporate-identity") return send(200, corporateIdentity());

  // The bank's issuer operator API (ADR 0054), behind its bearer token.
  if (req.url?.startsWith("/v1/admin/") || req.url?.startsWith("/v1/wallet-attestation/")) {
    if (req.headers.authorization !== "Bearer bank-operator-token") return send(401, { error: { message: "unauthorised" } });
  }
  if (req.method === "GET" && req.url?.startsWith("/v1/admin/credentials")) {
    const q = new URL(req.url, "http://x").searchParams;
    const known = q.get("kycReference") === "KYC-TI1";
    return send(200, { v: 1, credentials: known ? [{ credentialId: cid("bank corporate identity"), schema: SCHEMAS.corporateIdentity, subjectDid: CORP, state: "anchored", issuedAt: NOW - 200 * 86_400, expiresAt: NOW + 165 * 86_400, kycReference: "KYC-TI1" }] : [] });
  }
  if (req.method === "POST" && req.url === "/v1/wallet-attestation/eth/initiate") {
    const b = JSON.parse(body);
    const challengeId = `ch_${challenges.size + 1}`;
    const typedData = {
      types: {
        EIP712Domain: [{ name: "name", type: "string" }, { name: "version", type: "string" }, { name: "chainId", type: "uint256" }],
        WalletAttestation: [{ name: "holderDid", type: "string" }, { name: "walletAddress", type: "address" }, { name: "chain", type: "string" }, { name: "nonce", type: "string" }, { name: "purpose", type: "string" }],
      },
      primaryType: "WalletAttestation",
      domain: { name: "Wallet attestation", version: "1", chainId: Number(b.chain.split(":")[1]) },
      message: { holderDid: b.holderDid, walletAddress: b.walletAddress, chain: b.chain, nonce: challengeId, purpose: b.purpose },
    };
    challenges.set(challengeId, typedData);
    return send(200, { v: 1, challengeId, typedData, expiresAt: NOW + 600 });
  }
  if (req.method === "POST" && req.url === "/v1/wallet-attestation/eth/complete") {
    const b = JSON.parse(body);
    const td = challenges.get(b.challengeId) as any;
    const { EIP712Domain: _d, ...types } = td.types;
    let ok = false;
    if (b.addressType === "eoa") {
      ok = await verifyTypedData({ address: b.walletAddress, domain: td.domain, types, primaryType: td.primaryType, message: td.message, signature: b.signature }).catch(() => false);
    } else {
      const digest = hashTypedData({ domain: td.domain, types, primaryType: td.primaryType, message: td.message });
      const magic = await createPublicClient({ transport: http(RPC) }).readContract({ address: b.walletAddress, abi: parseAbi(["function isValidSignature(bytes32, bytes) view returns (bytes4)"]), functionName: "isValidSignature", args: [digest, b.signature] }).catch(() => "0x");
      ok = magic === "0x1626ba7e";
    }
    if (!ok) return send(400, { error: { message: "signature does not verify" } });
    return send(200, { v: 1, credentialId: cid(`wallet credential ${b.walletAddress}`), walletAddress: b.walletAddress, attestationMethod: b.addressType === "eoa" ? "EIP-712" : "EIP-1271", attestedAt: NOW, state: "signed_pending_anchor" });
  }
  send(404, {});
});
await new Promise<void>((r) => server.listen(PORT, r));
after(() => server.close());

// --- the site, configured as it would be on the test network ---

process.chdir(mkdtempSync(join(tmpdir(), "admission-"))); // a fresh development store
Object.assign(process.env, {
  NODE_ENV: "development",
  SITE_URL: "https://site.example",
  OPERATOR_EMAILS: "operator@example.org",
  CREDENTIAL_VERIFIER_URL: `http://127.0.0.1:${PORT}`,
  ADMISSION_VERIFIER_DID: "did:example:access-issuer",
  ADMISSION_VERIFIER_SEED: bytesToHex(new Uint8Array(32).fill(5)),
  ADMISSION_ISSUER_DID: ISSUER,
  ADMISSION_ISSUER_PUBKEY: bytesToHex(issuerKeys.publicKey),
  ADMISSION_SCHEMAS: JSON.stringify(SCHEMAS),
  ADMISSION_CORPORATE_ISSUERS: JSON.stringify({ [CORP]: `http://127.0.0.1:${PORT}` }),
  MANIFEST_PATH: MANIFEST,
  RPC_URL: RPC,
  // The local node's published Access Issuer key (account 2); the site refuses it on any other chain.
  SIGNER_KEYS: JSON.stringify({
    accessIssuer: "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a",
    custodian: "0xdbda1821b80551c9d65939329250298aa3472ba22feea921c0cf5d620ea67b97",
  }),
  BANK_ISSUER_URL: `http://127.0.0.1:${PORT}`,
  BANK_ISSUER_TOKEN: "bank-operator-token",
});
const { getStore } = await import("../lib/store.ts");
const service = await import("../lib/admission/service.ts");
const store = getStore();

const registrant = { id: "reg_officer", email: "officer@corp.example", name: "Officer", organisation: "Test Institution One", status: "approved" as const, createdAt: new Date().toISOString(), verifiedAt: null, decidedAt: null, decidedBy: null };
const operator = { ...registrant, id: "reg_operator", email: "operator@example.org" };
await store.createRegistrant(registrant);

/** The holder wallet: a presentation of one credential, answering the request it scanned. */
function presentation(request: any, schema: string, credential: string, disclosed: Record<string, unknown>) {
  const header = { v: 1, alg: "ML-DSA-65", hash: "RPO-256", iss: ISSUER, sub: OFFICER, iat: NOW - 3600, exp: NOW + 200 * 86_400, cid: credential, root: cid("r"), schema };
  return { v: 1, header, headerSig: "0x00", challenge: request.challenge, challengeSig: "0x00", disclosed: Object.entries(disclosed).map(([key, value], i) => ({ key, value, leafIndex: i, proof: [] })), timestamp: NOW, verifierRequest: request };
}

test("an officer admits a wallet by two scans and an operator's approval, and both grants are written", async () => {
  let a = await service.startAdmission(registrant, "https://site.example");
  assert.equal(a.status, "awaiting-officer");
  const officerRequest = (a.data as any).officerRequest;
  assert.ok(lodged.has(officerRequest.requestId), "the signed request is lodged with the verifier");
  assert.equal(officerRequest.response.callbackUrl, "https://site.example/api/admission/callback");

  // A presentation answering a request the site did not sign is ignored.
  const forged = presentation({ ...officerRequest, challenge: bytesToHex(new Uint8Array(32)) }, SCHEMAS.officer, cid("officer"), { corporationDid: CORP, role: "CEO" });
  assert.equal(await service.receivePresentation(forged, "https://site.example"), null);

  const v1 = await service.receivePresentation(presentation(officerRequest, SCHEMAS.officer, cid("officer"), { corporationDid: CORP, role: "CEO" }), "https://site.example");
  assert.equal(v1?.decision, "GRANT");
  a = (await store.admissionById(a.id))!;
  assert.equal(a.status, "awaiting-wallet");

  const walletRequest = (a.data as any).walletRequest;
  await service.receivePresentation(presentation(walletRequest, SCHEMAS.walletControl, cid("wallet"), { walletAddress: WALLET, chain: "eip155:1", addressType: "eoa" }), "https://site.example");
  a = (await store.admissionById(a.id))!;
  assert.equal(a.status, "ready", JSON.stringify((a.data as any).assessment?.problems ?? (a.data as any).error));

  // Replaying the officer presentation now does nothing.
  assert.equal(await service.receivePresentation(presentation(officerRequest, SCHEMAS.officer, cid("officer"), { corporationDid: CORP, role: "CEO" }), "https://site.example"), null);

  await assert.rejects(service.decideAdmission(a.id, "approve", registrant as any), /Not permitted/);
  await service.decideAdmission(a.id, "approve", operator as any);
  a = (await store.admissionById(a.id))!;
  assert.equal(a.status, "admitted", (a.data as any).error);
  await assert.rejects(service.decideAdmission(a.id, "approve", operator as any), /not awaiting a decision/);

  // Read back from the chain.
  const m = (await import("../lib/chain/manifest.ts")).loadManifest();
  const client = createPublicClient({ transport: http(RPC) });
  const allowed = await client.readContract({ address: m.venue.credentialGate, abi: parseAbi(["function isAllowed(address) view returns (bool)"]), functionName: "isAllowed", args: [WALLET] });
  assert.equal(allowed, true, "the pool grant is live");
  const grant = await client.readContract({
    address: m.venue.credentialGate,
    abi: parseAbi(["function grantOf(address) view returns ((uint40 expiresAt, uint8 path, bytes32 primaryCredential, bytes32 screeningCredential, bytes32 walletCredential, bytes32 authorityCredential, bytes32 evidence))"]),
    functionName: "grantOf",
    args: [WALLET],
  });
  assert.equal(grant.primaryCredential, cid("corporate identity"));
  assert.equal(grant.walletCredential, cid("wallet"));
  assert.equal(grant.authorityCredential, cid("officer"));
  const [flags, jurisdiction] = await client.readContract({ address: m.instruments!.registry, abi: parseAbi(["function liveFlags(address) view returns (uint32, uint16)"]), functionName: "liveFlags", args: [WALLET] });
  assert.equal(jurisdiction, 442, "Luxembourg");
  assert.equal(flags & (1 | 2 | 4 | 8192), 1 | 2 | 4 | 8192, "hold, receive, transfer, sanctions clear");
});

// --- the bank's routes (ADR 0054) ---

const RECORD = { legalName: "Test Institution One", jurisdiction: "LU", status: "active", screenedAt: NOW - 3600 };
const readPool = async (account: string) => {
  const m = (await import("../lib/chain/manifest.ts")).loadManifest();
  const client = createPublicClient({ transport: http(RPC) });
  const allowed = await client.readContract({ address: m.venue.credentialGate, abi: parseAbi(["function isAllowed(address) view returns (bool)"]), functionName: "isAllowed", args: [account as Hex] });
  const [flags, jurisdiction] = await client.readContract({ address: m.instruments!.registry, abi: parseAbi(["function liveFlags(address) view returns (uint32, uint16)"]), functionName: "liveFlags", args: [account as Hex] });
  return { m, client, allowed, flags, jurisdiction };
};

test("route 1, custodied: one staff action opens, binds, admits and readies a custody account", async () => {
  const a = await service.admitCustodied(operator as any, { kycReference: "KYC-TI1", instructionRef: "INS-2026-0001", clientRef: `TI1-${NOW}`, record: RECORD });
  assert.equal(a.status, "admitted", JSON.stringify((a.data as any).assessment?.problems ?? (a.data as any).error));
  const account = (a.data as any).admission.wallet.address as Hex;
  const { m, client, allowed, flags, jurisdiction } = await readPool(account);
  assert.equal(allowed, true, "the custody account is admitted to the pool");
  assert.equal(jurisdiction, 442);
  assert.equal(flags & (1 << 14), 1 << 14, "registered as a contract account");
  const allowance = await client.readContract({ address: m.assets.deposit.address, abi: parseAbi(["function allowance(address, address) view returns (uint256)"]), functionName: "allowance", args: [account, m.venue.permit2] });
  assert.ok(allowance > 0n, "ready to trade: the deposit is approved to Permit2");
  assert.equal((a.data as any).walletAttestation.wallet.attestationMethod, "EIP-1271", "the account itself signed");
});

test("route 1 refuses a client the bank has no corporate identity for, and only staff may admit", async () => {
  await assert.rejects(service.admitCustodied(registrant as any, { kycReference: "KYC-TI1", instructionRef: "x", clientRef: "y", record: RECORD }), /Not permitted/);
  await assert.rejects(service.admitCustodied(operator as any, { kycReference: "KYC-UNKNOWN", instructionRef: "x", clientRef: `U-${NOW}`, record: RECORD }), /no live corporate identity/);
});

test("route 2, self-custody: the client asks, the bank reviews, the client signs once", async () => {
  const key = privateKeyToAccount(keccak256(toBytes(`self-custody wallet ${NOW}`)));
  let a = await service.requestSelfCustody(registrant as any, { kycReference: "KYC-TI1", walletAddress: key.address, addressType: "eoa" });
  assert.equal(a.status, "awaiting-bank-review");
  assert.equal(challenges.size > 0 && [...challenges.values()].some((t: any) => t.message.walletAddress === key.address), false, "nothing is minted or challenged before the bank reviews");

  await assert.rejects(service.reviewSelfCustody(registrant as any, a.id, "approve", RECORD), /Not permitted/);
  await service.reviewSelfCustody(operator as any, a.id, "approve", RECORD);
  a = (await store.admissionById(a.id))!;
  assert.equal(a.status, "awaiting-signature");

  const td = (a.data as any).challenge.typedData;
  const { EIP712Domain: _d, ...types } = td.types;
  await assert.rejects(service.submitSelfCustodySignature(registrant as any, a.id, "0x1234"), /signature does not verify/);
  a = (await store.admissionById(a.id))!;
  assert.equal(a.status, "failed", "a bad signature fails the admission; the client starts again");

  let b = await service.requestSelfCustody(registrant as any, { kycReference: "KYC-TI1", walletAddress: key.address, addressType: "eoa" });
  await service.reviewSelfCustody(operator as any, b.id, "approve", RECORD);
  b = (await store.admissionById(b.id))!;
  const td2 = (b.data as any).challenge.typedData;
  const { EIP712Domain: _d2, ...types2 } = td2.types;
  const signature = await key.signTypedData({ domain: td2.domain, types: types2, primaryType: td2.primaryType, message: td2.message });
  b = await service.submitSelfCustodySignature(registrant as any, b.id, signature);
  assert.equal(b.status, "admitted", JSON.stringify((b.data as any).assessment?.problems ?? (b.data as any).error));
  const { allowed, jurisdiction } = await readPool(key.address);
  assert.equal(allowed, true, "the client's own wallet is admitted");
  assert.equal(jurisdiction, 442);
});
