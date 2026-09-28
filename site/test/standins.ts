/**
 * The services the site talks to, played locally for the tests: the protocol's hosted verifier,
 * the corporation's discovery endpoint, and the bank's issuer operator API. They answer as the
 * real services do, including their quirks (the bank sends integers in typed data as decimal
 * strings, and every call requires the service key), so the site's own code runs unchanged.
 *
 * Used by the Node integration test and by the browser tests' server. Nothing here reaches a
 * public network: the EIP-1271 check reads the local chain.
 */

import { createServer, type Server } from "node:http";
import { ml_dsa65 } from "@noble/post-quantum/ml-dsa";
import { bytesToHex, createPublicClient, hashTypedData, http, keccak256, parseAbi, toBytes, verifyTypedData } from "viem";
import { canonicalize } from "../lib/admission/canonical.ts";

export const ISSUER = "did:example:credential-issuer"; // the local stack's configured issuer
export const CORP = "did:example:corporation";
export const OFFICER = "did:example:officer";
export const SERVICE_KEY = "sk_test_integrationsecret";
export const KYC_REFERENCE = "KYC-TI1";
export const SCHEMAS = { officer: "schema:corporate-officer/v1", walletControl: "schema:wallet-control-eth/v1", corporateIdentity: "schema:corporate-identity/v1" };
export const issuerKeys = ml_dsa65.keygen(new Uint8Array(32).fill(21));

/** The holder wallet's presentation of one credential, answering a request it scanned. */
export function presentation(now: number, root: string, request: any, schema: string, credential: string, disclosed: Record<string, unknown>) {
  const header = { v: 1, alg: "ML-DSA-65", hash: "RPO-256", iss: ISSUER, sub: OFFICER, iat: now - 3600, exp: now + 200 * 86_400, cid: credential, root, schema };
  return { v: 1, header, headerSig: "0x00", challenge: request.challenge, challengeSig: "0x00", disclosed: Object.entries(disclosed).map(([key, value], i) => ({ key, value, leafIndex: i, proof: [] })), timestamp: now, verifierRequest: request };
}

export type StandIns = {
  server: Server;
  url: string;
  now: number;
  cid: (s: string) => `0x${string}`;
  lodged: Map<string, any>;
  challenges: Map<string, any>;
  /** The holder wallet's presentation of one credential, answering a request it scanned. */
  presentation: (request: any, schema: string, credential: string, disclosed: Record<string, unknown>) => Record<string, unknown>;
  /** The site's environment for these stand-ins and the given chain. */
  env: (rpc: string, manifestPath: string, siteUrl: string) => Record<string, string>;
  close: () => Promise<void>;
};

export async function startStandIns(port: number, rpc: string): Promise<StandIns> {
  const now = Math.floor(Date.now() / 1000);
  const cid = (s: string) => keccak256(toBytes(`${s}/${now}`));
  const lodged = new Map<string, any>();
  const challenges = new Map<string, any>();
  let lastLodged: any = null;

  function corporateIdentity() {
    const header = { v: 1, alg: "ML-DSA-65", hash: "RPO-256", iss: ISSUER, sub: CORP, iat: now - 86_400, exp: now + 365 * 86_400, cid: cid("corporate identity"), root: cid("root"), schema: SCHEMAS.corporateIdentity };
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
    const authorised = req.headers.authorization === `Bearer ${SERVICE_KEY}`;

    // For the browser tests, which play the holder wallet: the request the site last lodged.
    if (req.method === "GET" && req.url === "/test/last-lodged") return send(lastLodged ? 200 : 404, lastLodged ?? {});

    if (req.method === "POST" && req.url === "/v1/verifier-request") {
      if (!authorised) return send(401, { error: { code: "unauthenticated", message: "unauthenticated" } });
      const { request } = JSON.parse(body);
      lodged.set(request.requestId, request);
      lastLodged = request;
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

    // The bank's issuer operator API (ADR 0054), behind its service key (ADR 0055).
    if (req.url?.startsWith("/v1/admin/") || req.url?.startsWith("/v1/wallet-attestation/")) {
      if (!authorised) return send(401, { error: { code: "unauthenticated", message: "unauthenticated" } });
    }
    if (req.method === "GET" && req.url?.startsWith("/v1/admin/credentials")) {
      const q = new URL(req.url, "http://x").searchParams;
      const known = !q.has("kycReference") || q.get("kycReference") === KYC_REFERENCE;
      return send(200, { v: 1, credentials: known ? [{ credentialId: cid("bank corporate identity"), schema: SCHEMAS.corporateIdentity, subjectDid: CORP, state: "anchored", issuedAt: now - 200 * 86_400, expiresAt: now + 165 * 86_400, kycReference: KYC_REFERENCE }] : [] });
    }
    if (req.method === "POST" && req.url === "/v1/wallet-attestation/eth/initiate") {
      const b = JSON.parse(body);
      const challengeId = `ch_${challenges.size + 1}`;
      const typedData = {
        types: {
          EIP712Domain: [{ name: "name", type: "string" }, { name: "version", type: "string" }, { name: "chainId", type: "uint256" }],
          WalletAttestation: [{ name: "holderDid", type: "string" }, { name: "walletAddress", type: "address" }, { name: "chain", type: "string" }, { name: "nonce", type: "string" }, { name: "purpose", type: "string" }, { name: "issuedAt", type: "uint64" }],
        },
        primaryType: "WalletAttestation",
        // As the bank sends it: the chain id as a decimal string, read as decimal by the bank's library.
        domain: { name: "Wallet attestation", version: "1", chainId: b.chain.split(":")[1] },
        message: { holderDid: b.holderDid, walletAddress: b.walletAddress, chain: b.chain, nonce: challengeId, purpose: b.purpose, issuedAt: String(now) },
      };
      challenges.set(challengeId, typedData);
      return send(200, { v: 1, challengeId, typedData, expiresAt: Math.floor(Date.now() / 1000) + 600 });
    }
    if (req.method === "POST" && req.url === "/v1/wallet-attestation/eth/complete") {
      const b = JSON.parse(body);
      const stored = challenges.get(b.challengeId) as any;
      if (!stored) return send(404, { error: { message: "unknown challenge" } });
      const td = { ...stored, domain: { ...stored.domain, chainId: BigInt(stored.domain.chainId) }, message: { ...stored.message, issuedAt: BigInt(stored.message.issuedAt) } };
      const { EIP712Domain: _d, ...types } = td.types;
      let ok = false;
      if (b.addressType === "eoa") {
        ok = await verifyTypedData({ address: b.walletAddress, domain: td.domain, types, primaryType: td.primaryType, message: td.message, signature: b.signature }).catch(() => false);
      } else {
        const digest = hashTypedData({ domain: td.domain, types, primaryType: td.primaryType, message: td.message });
        const magic = await createPublicClient({ transport: http(rpc) }).readContract({ address: b.walletAddress, abi: parseAbi(["function isValidSignature(bytes32, bytes) view returns (bytes4)"]), functionName: "isValidSignature", args: [digest, b.signature] }).catch(() => "0x");
        ok = magic === "0x1626ba7e";
      }
      if (!ok) return send(400, { error: { message: "signature does not verify" } });
      return send(200, { v: 1, credentialId: cid(`wallet credential ${b.walletAddress}`), walletAddress: b.walletAddress, attestationMethod: b.addressType === "eoa" ? "EIP-712" : "EIP-1271", attestedAt: now, state: "signed_pending_anchor" });
    }
    send(404, {});
  });
  await new Promise<void>((r) => server.listen(port, "127.0.0.1", r));
  const url = `http://127.0.0.1:${port}`;

  return {
    server,
    url,
    now,
    cid,
    lodged,
    challenges,
    presentation: (request, schema, credential, disclosed) => presentation(now, cid("r"), request, schema, credential, disclosed),
    env: (chainRpc, manifestPath, siteUrl) => ({
      SITE_URL: siteUrl,
      OPERATOR_EMAILS: "operator@example.org",
      CREDENTIAL_VERIFIER_URL: url,
      ADMISSION_VERIFIER_DID: "did:example:access-issuer",
      ADMISSION_VERIFIER_SEED: bytesToHex(new Uint8Array(32).fill(5)),
      ADMISSION_ISSUER_DID: ISSUER,
      ADMISSION_ISSUER_PUBKEY: bytesToHex(issuerKeys.publicKey),
      ADMISSION_SCHEMAS: JSON.stringify(SCHEMAS),
      ADMISSION_CORPORATE_ISSUERS: JSON.stringify({ [CORP]: url }),
      MANIFEST_PATH: manifestPath,
      RPC_URL: chainRpc,
      // The local node's published keys (accounts 2 and 3); the site refuses them on any other chain.
      SIGNER_KEYS: JSON.stringify({
        accessIssuer: "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a",
        custodian: "0xdbda1821b80551c9d65939329250298aa3472ba22feea921c0cf5d620ea67b97",
      }),
      BANK_ISSUER_URL: url,
      BANK_ISSUER_API_KEY: SERVICE_KEY,
    }),
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}
