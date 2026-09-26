import type { Hex } from "viem";

/**
 * The bank's issuer backend, reached through its operator API as the bank's own onboarding system
 * (ADR 0054): the corporate identity it issued to a client, found by the client's customer
 * reference, and wallet-control credentials it mints once a wallet has signed.
 *
 * BANK_ISSUER_URL is the backend; BANK_ISSUER_TOKEN an operator session of the issuer's own staff.
 */

export type BankConfig = { url: string; token: string };

export function bankConfig(env: NodeJS.ProcessEnv = process.env): BankConfig {
  const url = env.BANK_ISSUER_URL?.trim().replace(/\/+$/, "");
  const token = env.BANK_ISSUER_TOKEN?.trim();
  if (!url || !token) throw new Error("BANK_ISSUER_URL and BANK_ISSUER_TOKEN are not set");
  return { url, token };
}

async function call<T>(b: BankConfig, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${b.url}${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { authorization: `Bearer ${b.token}`, ...(body === undefined ? {} : { "content-type": "application/json" }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(20_000), // a hung issuer must not hang the portal
  });
  const json = (await res.json().catch(() => null)) as any;
  if (!res.ok) throw new Error(`the bank's issuer answered ${res.status}: ${json?.error?.message ?? "no detail"}`);
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
};

/** The client's current corporate identity: the newest unexpired one issued under that reference. */
export async function corporateIdentityFor(b: BankConfig, kycReference: string, schema: string, nowSec: number): Promise<IssuedCredential> {
  const q = new URLSearchParams({ kycReference, schema, limit: "50" });
  const { credentials } = await call<{ credentials: IssuedCredential[] }>(b, `/v1/admin/credentials?${q}`);
  const live = credentials.filter((c) => c.schema === schema && Number(c.expiresAt) > nowSec && !/revoked/i.test(c.state));
  live.sort((x, y) => Number(y.issuedAt) - Number(x.issuedAt));
  if (!live.length) throw new Error(`the bank has no live corporate identity for customer ${kycReference}`);
  return live[0];
}

export type WalletChallenge = { challengeId: string; typedData: Record<string, any>; expiresAt: number };

export function startWalletAttestation(b: BankConfig, holderDid: string, chain: string, walletAddress: string, purpose: string) {
  return call<WalletChallenge>(b, "/v1/wallet-attestation/eth/initiate", { v: 1, holderDid, chain, walletAddress, purpose });
}

export type WalletAttested = { credentialId: Hex; walletAddress: string; attestationMethod: "EIP-712" | "EIP-1271"; attestedAt: number };

export function completeWalletAttestation(b: BankConfig, challengeId: string, walletAddress: string, addressType: "eoa" | "smart_contract", signature: Hex) {
  return call<WalletAttested>(b, "/v1/wallet-attestation/eth/complete", { v: 1, challengeId, walletAddress, addressType, signature });
}
