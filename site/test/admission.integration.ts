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
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bytesToHex, createPublicClient, createWalletClient, getAddress, keccak256, parseAbi, toBytes, http, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { CORP, ISSUER, OFFICER, SCHEMAS, startStandIns } from "./standins.ts";
import { startLaggingRpc } from "./lagging-rpc.ts";

const REPO = join(import.meta.dirname, "..", "..");
const MANIFEST = join(REPO, "ops", "addresses.json");
const RPC = process.env.RPC_URL ?? "http://127.0.0.1:8545";
const PORT = 4011;
const WALLET = getAddress(`0x${keccak256(toBytes(`admission wallet ${Date.now()}`)).slice(26)}`);

// --- the stand-in verifier, discovery endpoint and bank (test/standins.ts) ---

const LOCAL = JSON.parse(readFileSync(MANIFEST, "utf8"));
// The stand-in bank anchors each new credential three seconds after issuing it (the real bank: about a minute).
const standIns = await startStandIns(PORT, RPC, { revocations: LOCAL.credentialProtocol.revocations, anchorDelayMs: 3000 });
after(() => standIns.close());
const { now: NOW, cid, lodged, challenges } = standIns;

// The site reaches the chain through a proxy that answers reads from a block behind just after a
// receipt, as a load-balanced public RPC does (test/lagging-rpc.ts). The bank reads the node directly.
const lagging = await startLaggingRpc(PORT + 1, RPC);
after(() => lagging.close());

// --- the site, configured as it would be on the test network ---

process.chdir(mkdtempSync(join(tmpdir(), "admission-"))); // a fresh development store
Object.assign(process.env, { NODE_ENV: "development", ...standIns.env(lagging.url, MANIFEST, "https://site.example") });
const { getStore } = await import("../lib/store.ts");
const service = await import("../lib/admission/service.ts");
const store = getStore();

const registrant = { id: "reg_officer", email: "officer@corp.example", name: "Officer", organisation: "Test Institution One", status: "approved" as const, createdAt: new Date().toISOString(), verifiedAt: null, decidedAt: null, decidedBy: null };
const operator = { ...registrant, id: "reg_operator", email: "operator@example.org" };
await store.createRegistrant(registrant);

/** Moves an admission on, as the pages do, until it no longer waits for the bank's anchoring (ADR 0060). */
async function untilAnchored(id: string, timeoutMs = 30_000) {
  const until = Date.now() + timeoutMs;
  for (;;) {
    await service.advanceAdmission(id);
    const a = (await store.admissionById(id))!;
    if (a.status !== "awaiting-anchor" || Date.now() > until) return a;
    await new Promise((r) => setTimeout(r, 500));
  }
}

/** The holder wallet: a presentation of one credential, answering the request it scanned. */
const presentation = standIns.presentation;

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
  a = await untilAnchored(a.id);
  assert.equal(a.status, "admitted", (a.data as any).error);
  assert.equal((a.data as any).anchors.length, 3, "the officer, wallet and corporate identity credentials are each anchored");
  assert.ok((a.data as any).anchors.every((x: any) => x.verifiedOnChain), "each anchoring transaction was checked on the chain");
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
  const stale = lagging.staleReads();
  const started = Date.now();
  let a = await service.admitCustodied(operator as any, { kycReference: "KYC-TI1", instructionRef: "INS-2026-0001", clientRef: `TI1-${NOW}`, record: RECORD });
  // The new wallet credential is not anchored yet: nothing is granted until it is (ADR 0060).
  assert.equal(a.status, "awaiting-anchor", JSON.stringify((a.data as any).assessment?.problems ?? (a.data as any).error));
  assert.equal((await readPool((a.data as any).account)).allowed, false, "no grant before the credential is anchored");
  a = await untilAnchored(a.id);
  assert.equal(a.status, "admitted", JSON.stringify((a.data as any).error));
  const anchors = (a.data as any).anchors;
  assert.equal(anchors.length, 2, "the corporate identity and the wallet credential");
  assert.ok(anchors.every((x: any) => x.verifiedOnChain && x.anchoredRoot), "each anchor was read from the chain, with its batch root");
  assert.ok(lagging.staleReads() > stale, "some reads were answered from a block behind, and the admission still completed");
  assert.ok(Date.now() - started < 20_000, `a custodied admission takes under 20 s on one-second blocks with a 3 s anchor (took ${Date.now() - started} ms)`);
  const account = (a.data as any).admission.wallet.address as Hex;
  const { m, client, allowed, flags, jurisdiction } = await readPool(account);
  assert.equal(allowed, true, "the custody account is admitted to the pool");
  assert.equal(jurisdiction, 442);
  assert.equal(flags & (1 << 14), 1 << 14, "registered as a contract account");
  const allowance = await client.readContract({ address: m.assets.deposit.address, abi: parseAbi(["function allowance(address, address) view returns (uint256)"]), functionName: "allowance", args: [account, m.venue.permit2] });
  assert.ok(allowance > 0n, "ready to trade: the deposit is approved to Permit2");
  assert.equal((a.data as any).walletAttestation.wallet.attestationMethod, "EIP-1271", "the account itself signed");
});

test("an admission resting on a credential the bank never issued is refused, not waited for", async () => {
  const a = (await store.listAdmissions(30)).find((x: any) => x.route === "custodied" && x.status === "admitted")!;
  const d = a.data as any;
  const forged = { ...a, id: `adm_forged_${NOW}`, status: "awaiting-anchor" as const, data: { ...d, anchorSince: new Date().toISOString(), assessment: { ...d.assessment, attestation: { ...d.assessment.attestation, walletCredential: cid("never issued") } } } };
  await store.putAdmission(forged);
  await assert.rejects(service.advanceAdmission(forged.id), /no record of credential/);
  assert.equal((await store.admissionById(forged.id))!.status, "refused");
});

test("route 1: finishing is only for a custodied admission whose approvals failed", async () => {
  const done = (await store.listAdmissions(30)).find((x: any) => x.route === "custodied" && x.status === "admitted")!;
  await assert.rejects(service.finishCustodied(operator as any, done.id), /nothing to finish/);
  await assert.rejects(service.finishCustodied(registrant as any, done.id), /Not permitted/);
});

test("route 1 refuses a client the bank has no corporate identity for, and only staff may admit", async () => {
  await assert.rejects(service.admitCustodied(registrant as any, { kycReference: "KYC-TI1", instructionRef: "x", clientRef: "y", record: RECORD }), /Not permitted/);
  await assert.rejects(service.admitCustodied(operator as any, { kycReference: "KYC-UNKNOWN", instructionRef: "x", clientRef: `U-${NOW}`, record: RECORD }), /no live corporate identity/);
});

test("the bank's staff choose a client from the bank's own list of corporate identities", async () => {
  const bank = await import("../lib/admission/bank.ts");
  const list = await bank.corporateIdentities(bank.bankConfig(), SCHEMAS.corporateIdentity, NOW);
  assert.deepEqual(list.map((c) => c.kycReference), ["KYC-TI1"]);
});

test("route 2, self-custody: the bank confirms the KYB, then the client binds a wallet with one signature", async () => {
  const key = privateKeyToAccount(keccak256(toBytes(`self-custody wallet ${NOW}`)));
  const challengesBefore = challenges.size;
  let a = await service.requestSelfCustody(registrant as any);
  assert.equal(a.status, "awaiting-bank-review");

  // Binding is closed until the bank has confirmed the KYB; nothing is challenged or minted.
  await assert.rejects(service.startWalletBinding(registrant as any, a.id, { walletAddress: key.address, addressType: "eoa" }), /not confirmed yet/);
  assert.equal(challenges.size, challengesBefore, "no challenge before the bank confirms");

  await assert.rejects(service.reviewSelfCustody(registrant as any, a.id, "approve", { ...RECORD, kycReference: "KYC-TI1" }), /Not permitted/);
  // The client names no reference: the bank's staff choose it, and an unknown one finds nothing.
  await assert.rejects(service.reviewSelfCustody(operator as any, a.id, "approve", { ...RECORD, kycReference: "" }), /Choose the client's reference/);
  await service.reviewSelfCustody(operator as any, a.id, "approve", { ...RECORD, kycReference: "KYC-TI1" });
  a = (await store.admissionById(a.id))!;
  assert.equal(a.status, "kyb-confirmed");
  assert.equal((a.data as any).record.kycReference, "KYC-TI1");
  assert.equal(challenges.size, challengesBefore, "confirming the KYB issues no challenge either");

  // Another client cannot bind a wallet under this confirmation.
  await assert.rejects(service.startWalletBinding(operator as any, a.id, { walletAddress: key.address, addressType: "eoa" }), /not confirmed yet/);

  await service.startWalletBinding(registrant as any, a.id, { walletAddress: key.address, addressType: "eoa" });
  a = (await store.admissionById(a.id))!;
  assert.equal(a.status, "awaiting-signature");
  const td = (a.data as any).challenge.typedData;
  const { EIP712Domain: _d, ...types } = td.types;
  const signature = await key.signTypedData({ domain: td.domain, types, primaryType: td.primaryType, message: td.message });
  a = await service.submitSelfCustodySignature(registrant as any, a.id, signature);
  assert.equal(a.status, "awaiting-anchor", JSON.stringify((a.data as any).assessment?.problems ?? (a.data as any).error));
  a = await untilAnchored(a.id);
  assert.equal(a.status, "admitted", JSON.stringify((a.data as any).error));
  const { allowed, jurisdiction } = await readPool(key.address);
  assert.equal(allowed, true, "the client's own wallet is admitted with one signature");
  assert.equal(jurisdiction, 442);
});

test("route 2: a wrong signature fails the binding, and the client can bind again", async () => {
  const key = privateKeyToAccount(keccak256(toBytes(`second self-custody wallet ${NOW}`)));
  let a = await service.requestSelfCustody(registrant as any);
  assert.equal((a.data as any).request.knownReference, "KYC-TI1", "the reference confirmed last time is offered again");
  await service.reviewSelfCustody(operator as any, a.id, "approve", { ...RECORD, kycReference: "KYC-TI1" });
  await service.startWalletBinding(registrant as any, a.id, { walletAddress: key.address, addressType: "eoa" });
  await assert.rejects(service.submitSelfCustodySignature(registrant as any, a.id, "0x1234"), /signature does not verify/);
  a = (await store.admissionById(a.id))!;
  assert.equal(a.status, "kyb-confirmed", "the KYB stays confirmed");
  assert.match((a.data as any).error, /signature does not verify/);

  await service.startWalletBinding(registrant as any, a.id, { walletAddress: key.address, addressType: "eoa" });
  a = (await store.admissionById(a.id))!;
  const td = (a.data as any).challenge.typedData;
  const { EIP712Domain: _d, ...types } = td.types;
  a = await service.submitSelfCustodySignature(registrant as any, a.id, await key.signTypedData({ domain: td.domain, types, primaryType: td.primaryType, message: td.message }));
  a = await untilAnchored(a.id);
  assert.equal(a.status, "admitted", "bound on the second try, with no second review");
});

test("a client that started with a holder wallet can cancel and ask its bank instead", async () => {
  const a = await service.startAdmission(registrant, "https://site.example");
  const officerRequest = (a.data as any).officerRequest;
  await assert.rejects(service.cancelAdmission(operator as any, a.id), /can no longer be cancelled/, "only the client cancels its own");
  await service.cancelAdmission(registrant as any, a.id);
  assert.equal((await store.admissionById(a.id))!.status, "cancelled");

  // A scan that arrives after the cancel changes nothing.
  assert.equal(await service.receivePresentation(presentation(officerRequest, SCHEMAS.officer, cid("officer"), { corporationDid: CORP, role: "CEO" }), "https://site.example"), null);
  assert.equal((await store.admissionById(a.id))!.status, "cancelled");
  await assert.rejects(service.cancelAdmission(registrant as any, a.id), /can no longer be cancelled/);

  const b = await service.requestSelfCustody(registrant as any);
  assert.equal(b.status, "awaiting-bank-review");
  await service.cancelAdmission(registrant as any, b.id);
  await assert.rejects(service.reviewSelfCustody(operator as any, b.id, "approve", { ...RECORD, kycReference: "KYC-TI1" }), /not awaiting review/, "staff cannot confirm a cancelled request");
});

// --- offboarding and revocation (ADRs 0063, 0064): last, since the final test revokes the KYB ---

const GATE_ABI = parseAbi([
  "function isAllowed(address) view returns (bool)",
  "function void(address account)",
]);

test("staff offboard an admitted account: both grants go, with the reason recorded; the credentials stay", async () => {
  const a = (await store.listAdmissions(50)).find((x: any) => x.route === "custodied" && x.status === "admitted")!;
  const account = (a.data as any).assessment.summary.wallet as Hex;
  assert.equal((await readPool(account)).allowed, true);
  await assert.rejects(service.offboardAdmission(registrant as any, a.id, "test"), /Not permitted/);
  await assert.rejects(service.offboardAdmission(operator as any, a.id, "  "), /Give the reason/);
  await service.offboardAdmission(operator as any, a.id, "Client closed its account");
  const after = (await store.admissionById(a.id))!;
  assert.equal(after.status, "offboarded");
  assert.equal((after.data as any).offboarded.reason, "Client closed its account");
  assert.ok((after.data as any).offboarded.poolRevokeTx && (after.data as any).offboarded.registryRevokeTx);
  const { allowed, flags } = await readPool(account);
  assert.equal(allowed, false, "the pool grant is gone");
  assert.equal(flags, 0, "the Identity Registry grant is gone");
  const credential = (a.data as any).assessment.attestation.walletCredential.toLowerCase();
  assert.equal(standIns.issued.get(credential)?.revokedAt, null, "the credentials at the bank are untouched");
  await assert.rejects(service.offboardAdmission(operator as any, a.id, "again"), /Only an admitted account/);
});

test("revoking a wallet credential at the bank lets anyone void its pool grant", async () => {
  const a = (await store.listAdmissions(50)).find((x: any) => x.route === "self-custody" && x.status === "admitted")!;
  const account = (a.data as any).assessment.summary.wallet as Hex;
  await service.revokeAtBank(operator as any, a.id, "wallet", "Wallet reported compromised");
  const credential = (a.data as any).assessment.attestation.walletCredential.toLowerCase();
  assert.equal(standIns.issued.get(credential)?.state, "revoked");
  assert.equal(((await store.admissionById(a.id))!.data as any).bankRevocations[0].reason, "Wallet reported compromised");
  // The protocol's own path: the revocation is on-chain, so any caller removes the grant.
  const m = (await import("../lib/chain/manifest.ts")).loadManifest();
  // Mnemonic index 20: a wallet signer, holding no role on the gate.
  const wallet = createWalletClient({ account: privateKeyToAccount("0xeaa861a9a01391ed3d587d8a5a84ca56ee277629a8b02c22093a419bf240e65d"), transport: http(RPC) });
  const hash = await wallet.writeContract({ address: m.venue.credentialGate, abi: GATE_ABI, functionName: "void", args: [account], chain: null });
  await createPublicClient({ transport: http(RPC) }).waitForTransactionReceipt({ hash });
  assert.equal((await readPool(account)).allowed, false, "voided by an unprivileged caller");
});

test("revoking a corporate identity needs the count of wallets it withdraws, and a changed count stops it", async () => {
  const a = (await store.listAdmissions(50)).find((x: any) => x.route === "holder-wallet" && x.status === "admitted")!;
  const cid = (a.data as any).assessment.attestation.primaryCredential;
  const affected = (await service.restingOn(cid)).length;
  assert.ok(affected >= 1);
  await assert.rejects(service.revokeAtBank(operator as any, a.id, "corporate", "KYB withdrawn", affected + 1), /look again/);
  assert.notEqual(standIns.issued.get(cid.toLowerCase())?.state, "revoked", "nothing was revoked");
  await service.revokeAtBank(operator as any, a.id, "corporate", "KYB withdrawn", affected);
  assert.equal(standIns.issued.get(cid.toLowerCase())?.state, "revoked");
});
