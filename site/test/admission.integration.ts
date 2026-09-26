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
import { bytesToHex, createPublicClient, getAddress, http, keccak256, parseAbi, toBytes } from "viem";
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
  SIGNER_KEYS: JSON.stringify({ accessIssuer: "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a" }),
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
