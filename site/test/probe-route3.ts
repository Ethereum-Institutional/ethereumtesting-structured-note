/**
 * Checks the real services route 3 depends on, before anyone scans: the corporation's published
 * corporate identity, and the bank's verifier accepting both signed requests. Uses the site's own
 * protocol code and settings built from ops/ files, as ops/vercel-admission-env.sh builds them.
 * Sends no transaction and prints no key.
 *
 *   (set -a; . ../ops/keys.base-sepolia-integration.env; set +a; node test/probe-route3.ts)
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { corporateIdentity, headerSignatureValid, lodge, protocolConfig, signedRequest } from "../lib/admission/protocol.ts";

const OPS = join(import.meta.dirname, "..", "..", "ops");
const net = JSON.parse(readFileSync(join(OPS, "networks", "base-sepolia.json"), "utf8"));
// The key file is sourced by the shell that runs this (see below), never parsed here, so no
// value can reach an error message.
const keys = process.env;
const adm = net.admission;
const bankKey = JSON.parse(readFileSync(join(OPS, "..", adm.bankIssuerKeyFile), "utf8"));
const env = {
  ADMISSION_ISSUER_DID: net.credentialProtocol.issuerDid,
  ADMISSION_ISSUER_PUBKEY: bankKey.mlDsaPubkey,
  ADMISSION_SCHEMAS: JSON.stringify({ officer: net.schemas.officer, walletControl: net.schemas.walletControl, corporateIdentity: net.schemas.corporateIdentity }),
  ADMISSION_CORPORATE_ISSUERS: JSON.stringify(adm.corporateIssuers),
  CREDENTIAL_VERIFIER_URL: adm.credentialVerifierUrl,
  ADMISSION_VERIFIER_DID: adm.verifierDid,
  ADMISSION_VERIFIER_NAME: adm.verifierName,
  ADMISSION_VERIFIER_SEED: keys.ADMISSION_VERIFIER_SEED,
  ADMISSION_VERIFIER_INLINE_KEY: "1",
  BANK_ISSUER_URL: keys.BANK_ISSUER_URL,
  BANK_ISSUER_API_KEY: keys.BANK_ISSUER_API_KEY,
} as unknown as NodeJS.ProcessEnv;

const c = protocolConfig("https://structurednote-project.ethereumtesting.com", env);
const ok = (b: boolean) => (b ? "ok  " : "FAIL");
console.log(`verifier ${c.verifierUrl} (service key sent: ${Boolean(c.verifierKey)})`);

// 1. Each configured corporation's published corporate identity.
for (const did of Object.keys(c.corporateIssuers)) {
  try {
    const doc = await corporateIdentity(c, did);
    const h = doc.credential?.header;
    const claims = doc.credential?.claims ?? {};
    console.log(`\ncorporate identity for ${did}`);
    console.log(`  ${ok(doc.issuerDid === c.issuerDid)} issuerDid ${doc.issuerDid}`);
    console.log(`  ${ok(doc.subjectDid === did)} subjectDid ${doc.subjectDid}`);
    console.log(`  ${ok(h?.iss === c.issuerDid)} header.iss ${h?.iss}`);
    console.log(`  ${ok(h?.schema === c.schemas.corporateIdentity)} header.schema ${h?.schema}`);
    console.log(`  ${ok(h?.sub === did)} header.sub ${h?.sub}`);
    console.log(`  ${ok(Number(h?.exp) > Date.now() / 1000)} header.exp ${h?.exp ? new Date(Number(h.exp) * 1000).toISOString() : "none"}`);
    console.log(`  ${ok(Boolean(h) && headerSignatureValid(h, doc.credential.headerSig, c.issuerPublicKey))} signature against the pinned bank key`);
    console.log(`  ${ok(claims.status === "active")} status ${JSON.stringify(claims.status)}`);
    console.log(`  ${ok(typeof claims.jurisdiction === "string")} jurisdiction ${JSON.stringify(claims.jurisdiction)}`);
    console.log(`       investorClass ${JSON.stringify(claims.investorClass)} (absent means institutional)`);
    for (const slot of ["ceoOfficerDid", "cooOfficerDid", "cfoOfficerDid"]) console.log(`       ${slot} ${JSON.stringify(claims[slot])}`);
    console.log(`       claim keys: ${Object.keys(claims).join(", ")}`);
    console.log(`       iat ${h?.iat ? new Date(Number(h.iat) * 1000).toISOString() : "none"} (route 3 treats issuance as the screening date: 30 days max)`);
  } catch (e) {
    console.log(`\ncorporate identity for ${did}\n  FAIL ${(e as Error).message}`);
  }
}

// 2. The bank's verifier accepts both requests, as the QR codes would carry them.
for (const step of ["officer", "wallet"] as const) {
  const request = signedRequest(c, step, Math.floor(Date.now() / 1000));
  try {
    const url = await lodge(c, request);
    const back = await fetch(url, { signal: AbortSignal.timeout(20_000) });
    console.log(`\n${ok(back.ok)} ${step} request lodged (schema ${request.filter.schemas?.list?.[0]}); fetching it back: HTTP ${back.status}`);
  } catch (e) {
    console.log(`\nFAIL ${step} request: ${(e as Error).message}`);
  }
}
