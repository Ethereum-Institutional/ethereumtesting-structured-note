import { randomBytes, randomUUID } from "node:crypto";
import { ml_dsa65 } from "@noble/post-quantum/ml-dsa";
import { bytesToHex, hexToBytes } from "viem";
import { canonicalize } from "./canonical.ts";

/**
 * The credential protocol, as the Access Issuer meets it (ADRs 0045 to 0047): the shapes it
 * exchanges, the Access Issuer's signed verifier requests, the hosted verifier's verdict, and the
 * corporation's published corporate identity.
 */

export type CredentialHeader = {
  v: 1;
  alg: string;
  hash: string;
  iss: string;
  sub: string;
  iat: number;
  exp: number;
  cid: string;
  root: string;
  schema: string;
};

export type Presentation = {
  v: 1 | 2;
  header: CredentialHeader;
  headerSig: string;
  challenge: string;
  disclosed: Array<{ key: string; value: unknown }>;
  verifierRequest?: VerifierRequest;
  [k: string]: unknown;
};

export type VerifierRequest = {
  v: 1;
  verifierDid: string;
  verifierName?: string;
  verifierPublicKey?: string;
  requestId: string;
  issuedAt: number;
  expiresAt: number;
  challenge: string;
  filter: {
    issuers?: { mode: "wildcard" | "allow"; list?: string[] };
    schemas?: { mode: "wildcard" | "allow"; list?: string[] };
    requiredClaims: string[];
  };
  response: { mode: "callback" | "qrBack"; callbackUrl?: string };
  signature?: string;
};

export type Verdict = {
  v: 1;
  decision: "GRANT" | "DENY";
  reason: string;
  checks: Record<string, boolean | null>;
  disclosed?: Record<string, unknown>;
  diagnostic?: { failingCheck: string; detail: string };
};

/** The corporation's corporate identity, as its issuer backend publishes it for discovery. */
export type CorporateIdentityDocument = {
  issuerDid: string;
  subjectDid: string;
  credential: { header: CredentialHeader; headerSig: string; claims: Record<string, unknown> };
};

export type Step = "officer" | "wallet";

export type ProtocolConfig = {
  verifierUrl: string;
  verifierDid: string;
  verifierName: string;
  /** 32-byte seed of the Access Issuer's ML-DSA-65 verifier key. */
  verifierSeed: Uint8Array;
  /** Inline the public key rather than rely on the protocol's verifier registry. */
  inlineKey: boolean;
  /** The one issuer every credential must come from (ADR 0052). */
  issuerDid: string;
  /** That issuer's ML-DSA-65 public key, pinned here rather than read from a registry (ADR 0042). */
  issuerPublicKey: Uint8Array;
  schemas: { officer: string; walletControl: string; corporateIdentity: string };
  /** Where each corporation publishes its corporate identity, by DID. */
  corporateIssuers: Record<string, string>;
  callbackUrl: string;
  /** The service key, when the verifier is the bank's own backend and requires it (ADR 0055). */
  verifierKey?: string;
};

const need = (env: NodeJS.ProcessEnv, k: string) => {
  const v = env[k]?.trim();
  if (!v) throw new Error(`${k} is not set`);
  return v;
};

export function protocolConfig(origin: string, env: NodeJS.ProcessEnv = process.env): ProtocolConfig {
  const schemas = JSON.parse(need(env, "ADMISSION_SCHEMAS"));
  for (const k of ["officer", "walletControl", "corporateIdentity"]) {
    if (typeof schemas[k] !== "string") throw new Error(`ADMISSION_SCHEMAS lacks ${k}`);
  }
  const seed = hexToBytes(need(env, "ADMISSION_VERIFIER_SEED") as `0x${string}`);
  if (seed.length !== 32) throw new Error("ADMISSION_VERIFIER_SEED must be 32 bytes");
  return {
    verifierUrl: need(env, "CREDENTIAL_VERIFIER_URL").replace(/\/+$/, ""),
    verifierDid: need(env, "ADMISSION_VERIFIER_DID"),
    verifierName: env.ADMISSION_VERIFIER_NAME?.trim() || "Access Issuer",
    verifierSeed: seed,
    inlineKey: env.ADMISSION_VERIFIER_INLINE_KEY === "1",
    issuerDid: need(env, "ADMISSION_ISSUER_DID"),
    issuerPublicKey: hexToBytes(need(env, "ADMISSION_ISSUER_PUBKEY") as `0x${string}`),
    schemas,
    corporateIssuers: JSON.parse(need(env, "ADMISSION_CORPORATE_ISSUERS")),
    callbackUrl: `${origin}/api/admission/callback`,
    verifierKey: verifierKeyFor(need(env, "CREDENTIAL_VERIFIER_URL"), env),
  };
}

/**
 * The key is sent only to the backend it was issued by: the bank's service key goes to the
 * verifier only when the verifier is the bank's own host.
 */
function verifierKeyFor(verifierUrl: string, env: NodeJS.ProcessEnv): string | undefined {
  const key = env.BANK_ISSUER_API_KEY?.trim();
  const bank = env.BANK_ISSUER_URL?.trim();
  if (!key || !bank) return undefined;
  try {
    return new URL(verifierUrl).origin === new URL(bank).origin ? key : undefined;
  } catch {
    return undefined;
  }
}

function verifierHeaders(c: ProtocolConfig): Record<string, string> {
  return { "content-type": "application/json", ...(c.verifierKey ? { authorization: `Bearer ${c.verifierKey}` } : {}) };
}

/** What every route needs: the one configured issuer and the schema identifiers. */
export function policyConfig(env: NodeJS.ProcessEnv = process.env): Pick<ProtocolConfig, "issuerDid" | "schemas"> {
  const schemas = JSON.parse(need(env, "ADMISSION_SCHEMAS"));
  return { issuerDid: need(env, "ADMISSION_ISSUER_DID"), schemas };
}

/** The claims each step asks the holder to disclose. */
export const REQUIRED_CLAIMS: Record<Step, string[]> = {
  officer: ["corporationDid", "role"],
  wallet: ["walletAddress", "chain", "addressType"],
};

/** A request for one credential, signed by the Access Issuer over its canonical form. */
export function signedRequest(c: ProtocolConfig, step: Step, nowSec: number): VerifierRequest {
  const keys = ml_dsa65.keygen(c.verifierSeed);
  const unsigned: VerifierRequest = {
    v: 1,
    verifierDid: c.verifierDid,
    verifierName: c.verifierName,
    ...(c.inlineKey ? { verifierPublicKey: bytesToHex(keys.publicKey) } : {}),
    requestId: randomUUID(),
    issuedAt: nowSec,
    expiresAt: nowSec + 300,
    challenge: bytesToHex(randomBytes(32)),
    filter: {
      issuers: { mode: "allow", list: [c.issuerDid] },
      schemas: { mode: "allow", list: [step === "officer" ? c.schemas.officer : c.schemas.walletControl] },
      requiredClaims: REQUIRED_CLAIMS[step],
    },
    response: { mode: "callback", callbackUrl: c.callbackUrl },
  };
  const signature = bytesToHex(ml_dsa65.sign(keys.secretKey, canonicalize(unsigned)));
  return { ...unsigned, signature };
}

/** The Access Issuer's verifier public key, for its registration with the protocol. */
export function verifierPublicKey(c: ProtocolConfig): `0x${string}` {
  return bytesToHex(ml_dsa65.keygen(c.verifierSeed).publicKey);
}

/** Verifies a request as the holder wallet and the protocol's verifier do. */
export function requestSignatureValid(request: VerifierRequest, publicKey: Uint8Array): boolean {
  const { signature, ...rest } = request;
  if (!signature) return false;
  try {
    return ml_dsa65.verify(publicKey, canonicalize(rest), hexToBytes(signature as `0x${string}`));
  } catch {
    return false;
  }
}

/** Lodges the signed request with the hosted verifier; returns the address the QR code carries. */
export async function lodge(c: ProtocolConfig, request: VerifierRequest): Promise<string> {
  const res = await fetch(`${c.verifierUrl}/v1/verifier-request`, {
    method: "POST",
    headers: verifierHeaders(c),
    body: JSON.stringify({ request }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) {
    const e = (await res.json().catch(() => null)) as any;
    throw new Error(`the verifier refused the request: HTTP ${res.status}${e?.error?.code ? ` ${e.error.code}` : ""}`);
  }
  return `${c.verifierUrl}/v1/verifier-request/${request.requestId}`;
}

/** The hosted verifier's verdict on a presentation (ADR 0047). */
export async function verdictFor(c: ProtocolConfig, presentation: Presentation): Promise<Verdict> {
  const res = await fetch(`${c.verifierUrl}/v1/verify`, {
    method: "POST",
    headers: verifierHeaders(c),
    body: JSON.stringify({
      v: 1,
      challengeContext: { requestId: presentation.verifierRequest?.requestId ?? "", issuedAt: 0, expiresAt: 0 },
      presentation,
    }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`the verifier did not answer: HTTP ${res.status}`);
  return (await res.json()) as Verdict;
}

/** The corporation's corporate identity, from where the configuration says it publishes it. */
export async function corporateIdentity(c: ProtocolConfig, corporationDid: string): Promise<CorporateIdentityDocument> {
  const base = c.corporateIssuers[corporationDid];
  if (!base) throw new Error(`no discovery address is configured for ${corporationDid}`);
  const res = await fetch(`${base.replace(/\/+$/, "")}/v1/issuer/corporate-identity`, { signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`${corporationDid} publishes no corporate identity: HTTP ${res.status}`);
  return (await res.json()) as CorporateIdentityDocument;
}

/** A credential header's signature, against the pinned issuer key. */
export function headerSignatureValid(header: CredentialHeader, headerSig: string, publicKey: Uint8Array): boolean {
  try {
    const sig = hexToBytes((headerSig.startsWith("0x") ? headerSig : `0x${headerSig}`) as `0x${string}`);
    return ml_dsa65.verify(publicKey, canonicalize(header), sig);
  } catch {
    return false;
  }
}
