import type { Hex } from "viem";

/**
 * The bank's issuer backend, reached through its operator API as the bank's own onboarding system
 * (ADR 0054): the corporate identity it issued to a client, found by the client's customer
 * reference, and wallet-control credentials it mints once a wallet has signed.
 *
 * BANK_ISSUER_URL is the backend (HTTPS only); BANK_ISSUER_API_KEY a service key issued to this
 * site with the scopes it needs, credentials:read and wallet-attestation:eth (ADR 0055). The key
 * is sent only in the Authorization header, never in a URL or a log line.
 */

export type BankConfig = { url: string; key: string };

export function bankConfig(env: NodeJS.ProcessEnv = process.env): BankConfig {
  const url = env.BANK_ISSUER_URL?.trim().replace(/\/+$/, "");
  const key = env.BANK_ISSUER_API_KEY?.trim();
  if (!url || !key) throw new Error("BANK_ISSUER_URL and BANK_ISSUER_API_KEY are not set");
  if (!url.startsWith("https://") && !/^http:\/\/(127\.0\.0\.1|localhost)(:|\/|$)/.test(url)) {
    throw new Error("BANK_ISSUER_URL must be https: a key sent in plaintext is disclosed");
  }
  if (!/^sk_\S+$/.test(key)) throw new Error("BANK_ISSUER_API_KEY is not a service key (sk_...)");
  return { url, key };
}

/** A refusal by the bank's API, with its code. 401 and 403 mean the key needs attention: never retried. */
export class BankRefused extends Error {
  readonly status: number;
  readonly code: string;
  constructor(message: string, status: number, code: string) {
    super(message);
    this.name = "BankRefused";
    this.status = status;
    this.code = code;
  }
}

async function call<T>(b: BankConfig, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${b.url}${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { authorization: `Bearer ${b.key}`, ...(body === undefined ? {} : { "content-type": "application/json" }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(20_000), // a hung issuer must not hang the portal
  });
  const json = (await res.json().catch(() => null)) as any;
  if (!res.ok) {
    const code = String(json?.error?.code ?? "unknown");
    const detail = String(json?.error?.message ?? "no detail");
    const meaning =
      res.status === 401 ? "the bank did not accept the site's API key; it needs replacing or rotating"
      : code === "scope_forbidden" ? `the site's API key lacks the scope for ${path.split("?")[0]}`
      : code === "service_key_forbidden" ? `${path.split("?")[0]} is for the bank's staff only`
      : `the bank refused: ${detail}`;
    throw new BankRefused(`${meaning} (${res.status} ${code})`, res.status, code);
  }
  return json as T;
}

export type IssuedCredential = {
  credentialId: Hex;
  schema: string;
  subjectDid: string;
  state: string;
  issuedAt: number;
  expiresAt: number;
  kycReference?: string;
  /** The credential's own root, and where the bank anchored the batch containing it (ADR 0060). */
  rootHex?: string | null;
  rootAnchorTxHash?: string | null;
  rootAnchorChain?: string | null;
  revokedAt?: number | string | null;
};

/** Every credential the bank has issued, newest included, with its anchoring. */
export async function issuedCredentials(b: BankConfig): Promise<IssuedCredential[]> {
  const { credentials } = await call<{ credentials: IssuedCredential[] }>(b, `/v1/admin/credentials?limit=500`);
  return credentials;
}

/** The bank's live corporate identities: the newest unexpired, unrevoked one for each client reference. */
export async function corporateIdentities(b: BankConfig, schema: string, nowSec: number, kycReference?: string): Promise<IssuedCredential[]> {
  const q = new URLSearchParams({ ...(kycReference ? { kycReference } : {}), schema, limit: "50" });
  const { credentials } = await call<{ credentials: IssuedCredential[] }>(b, `/v1/admin/credentials?${q}`);
  const live = credentials.filter((c) => c.schema === schema && Number(c.expiresAt) > nowSec && !/revoked/i.test(c.state) && c.kycReference);
  live.sort((x, y) => Number(y.issuedAt) - Number(x.issuedAt));
  const seen = new Set<string>();
  return live.filter((c) => !seen.has(c.kycReference!) && seen.add(c.kycReference!));
}

/** The client's current corporate identity: the newest unexpired one issued under that reference. */
export async function corporateIdentityFor(b: BankConfig, kycReference: string, schema: string, nowSec: number): Promise<IssuedCredential> {
  const [current] = (await corporateIdentities(b, schema, nowSec, kycReference)).filter((c) => c.kycReference === kycReference);
  if (!current) throw new Error(`the bank has no live corporate identity for customer ${kycReference}`);
  return current;
}

export type WalletChallenge = { challengeId: string; typedData: Record<string, any>; expiresAt: number };

/**
 * The bank's typed data with every integer as a number. The bank sends some as decimal strings
 * (the domain's chainId, "84532"); its own library reads those as decimal, but viem does not, so
 * signing them as sent produces a signature over a different digest, which the bank then refuses.
 * Numbers give the same digest under both.
 */
export function normaliseTypedData(td: Record<string, any>): Record<string, any> {
  const asNumber = (v: unknown) => {
    if (typeof v !== "string" || !/^\d+$/.test(v)) return v;
    const n = Number(v);
    if (!Number.isSafeInteger(n)) throw new Error(`an integer in the typed data is too large to sign safely: ${v}`);
    return n;
  };
  const out = structuredClone(td);
  if (out.domain && "chainId" in out.domain) out.domain.chainId = asNumber(out.domain.chainId);
  for (const field of out.types?.[out.primaryType] ?? []) {
    if (/^u?int\d*$/.test(field.type) && out.message && field.name in out.message) {
      out.message[field.name] = asNumber(out.message[field.name]);
    }
  }
  return out;
}

export async function startWalletAttestation(b: BankConfig, holderDid: string, chain: string, walletAddress: string, purpose: string) {
  const c = await call<WalletChallenge>(b, "/v1/wallet-attestation/eth/initiate", { v: 1, holderDid, chain, walletAddress, purpose });
  return { ...c, typedData: normaliseTypedData(c.typedData) };
}

export type WalletAttested = { credentialId: Hex; walletAddress: string; attestationMethod: "EIP-712" | "EIP-1271"; attestedAt: number };

export function completeWalletAttestation(b: BankConfig, challengeId: string, walletAddress: string, addressType: "eoa" | "smart_contract", signature: Hex) {
  return call<WalletAttested>(b, "/v1/wallet-attestation/eth/complete", { v: 1, challengeId, walletAddress, addressType, signature });
}

/** Revokes a credential at the bank (ADR 0064). The bank records the revocation in the protocol's registry. */
export function revokeCredential(b: BankConfig, credentialId: string, reason: string) {
  return call<Record<string, unknown>>(b, `/v1/credentials/${encodeURIComponent(credentialId)}/revoke`, { v: 1, reason });
}

export type Issued = { issuanceId: string; credentialId: string; state: string; pickupUrl: string; estimatedAnchorAt?: number };

/**
 * Issues a credential from claims the site supplies (ADR 0066), through the issuer server's own
 * two steps, under the service scope credentials:issue. The server signs it at once and anchors it
 * in its next batch. The pickup URL is how a holder (a Maknoon wallet, or a corporation's issuer
 * backend) collects it.
 */
export async function issueCredential(
  b: BankConfig,
  input: { schema: string; subjectDid: string; kycReference: string; validitySeconds: number; claims: Record<string, unknown> },
): Promise<Issued> {
  const started = await call<{ issuanceId: string }>(b, "/v1/issuance/initiate", {
    v: 1,
    schema: input.schema,
    subjectDid: input.subjectDid,
    kycProvider: "manual",
    kycReference: input.kycReference,
    validitySeconds: input.validitySeconds,
  });
  const done = await call<Issued>(b, `/v1/issuance/${encodeURIComponent(started.issuanceId)}/complete`, { v: 1, claimsOverride: input.claims });
  return { ...done, issuanceId: started.issuanceId };
}
