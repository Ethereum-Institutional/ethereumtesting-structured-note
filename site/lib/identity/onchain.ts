import "server-only";
import { defineChain, encodeAbiParameters, keccak256, parseAbi, toBytes, type Address, type Hex } from "viem";
import { loadManifest } from "../chain/manifest.ts";
import { signers } from "../chain/signer.ts";
import { until } from "../chain/until.ts";

/**
 * Identities and claims on the chain (ADRs 0088, 0089): ONCHAINID identities created by the bank,
 * claim keys as a client's consent, claims each institution signs and adds, the wallet registered
 * in the shared identity storage, and the hand-over of a self-custody identity to its client.
 *
 * Every write is made as the capacity whose role it is: the bank creates and registers, an
 * identity's manager records consent, each institution vouches for what it is responsible for.
 */

export const TOPIC = {
  deposit: BigInt(keccak256(toBytes("claim.deposit-eligible"))),
  note: BigInt(keccak256(toBytes("claim.note-eligible"))),
  termSheet: BigInt(keccak256(toBytes("claim.term-sheet"))),
  pool: BigInt(keccak256(toBytes("claim.pool-access"))),
} as const;
export type Topic = "deposit" | "note" | "pool";

const MANAGEMENT = 1n;
const CLAIM = 3n;
const ECDSA = 1n;
const COUNTRY = 276;
/** How long a claim runs (ADR 0088): the claim issuers allow at most a year. */
export const CLAIM_DAYS = 180;
/** How long a pool-access claim runs (ADR 0090): the longest the pool accepts between screenings. */
export const POOL_CLAIM_DAYS = 90;

const ID_FACTORY = parseAbi([
  "function createIdentityWithManagementKeys(address wallet, string salt, bytes32[] managementKeys) returns (address)",
  "function getIdentity(address wallet) view returns (address)",
]);
const IDENTITY = parseAbi([
  "function addKey(bytes32 key, uint256 purpose, uint256 keyType) returns (bool)",
  "function removeKey(bytes32 key, uint256 purpose) returns (bool)",
  "function keyHasPurpose(bytes32 key, uint256 purpose) view returns (bool)",
  "function getKeyPurposes(bytes32 key) view returns (uint256[])",
  "function addClaim(uint256 topic, uint256 scheme, address issuer, bytes signature, bytes data, string uri) returns (bytes32)",
  "function getClaim(bytes32 claimId) view returns (uint256 topic, uint256 scheme, address issuer, bytes signature, bytes data, string uri)",
]);
const REGISTRY = parseAbi([
  "function registerIdentity(address wallet, address identity, uint16 country)",
  "function deleteIdentity(address wallet)",
  "function identity(address wallet) view returns (address)",
  "function contains(address wallet) view returns (bool)",
  "function isVerified(address wallet) view returns (bool)",
]);
const POOL_GATE = parseAbi([
  "function standing(address account) view returns (uint8)",
  "function withdrawn(address account) view returns (bool)",
]);
/** The pool gate's answer, in the order the gate asks (contracts/IdentityPoolGate.sol). */
export const STANDING = ["admitted", "withdrawn by supervision", "no valid pool-access claim", "jurisdiction not served"] as const;
export type Standing = (typeof STANDING)[number];
const ISSUER = parseAbi([
  "function isClaimValid(address identity, uint256 topic, bytes sig, bytes data) view returns (bool)",
  "function revokeClaimBySignature(bytes signature)",
  "function isClaimRevoked(bytes sig) view returns (bool)",
]);

export function context() {
  const m = loadManifest();
  if (!m.identity) throw new Error("the manifest has no identity scaffolding: deploy 0.2.0");
  const rpc = process.env.RPC_URL?.trim();
  if (!rpc) throw new Error("RPC_URL is not set");
  const chain = defineChain({ id: m.chainId, name: `chain ${m.chainId}`, nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [rpc] } } });
  return { m, id: m.identity, s: signers(chain, rpc) };
}

const keyOf = (a: Address) => keccak256(encodeAbiParameters([{ type: "address" }], [a]));
const claimId = (issuer: Address, topic: bigint) => keccak256(encodeAbiParameters([{ type: "address" }, { type: "uint256" }], [issuer, topic]));

/** The institution that vouches for each topic, and its signing capacity and claim issuer. */
export function vouchers() {
  const { id } = context();
  return {
    deposit: { capacity: "depositAgent", issuer: id.bankIssuer as Address, label: "the bank" },
    note: { capacity: "accessIssuer", issuer: id.onboardingIssuer as Address, label: "the onboarding agent" },
    pool: { capacity: "depositAgent", issuer: id.bankIssuer as Address, label: "the bank" },
  } satisfies Record<Topic, { capacity: string; issuer: Address; label: string }>;
}

// --- reads ---

/** The identity a wallet is registered against in the shared storage, or null. */
export async function identityOf(wallet: Address): Promise<Address | null> {
  const { id, s } = context();
  const found = await s.publicClient.readContract({ address: id.depositRegistry, abi: REGISTRY, functionName: "identity", args: [wallet] });
  return /^0x0{40}$/i.test(found) ? null : found;
}

export type ClaimView = { topic: Topic; issuer: Address; present: boolean; valid: boolean; revoked: boolean; issuedAt: number; validUntil: number; recordHash: Hex | null; signature: Hex | null };

function decodeData(data: Hex): { issuedAt: number; validUntil: number; recordHash: Hex } | null {
  if ((data.length - 2) / 2 !== 96) return null;
  const word = (i: number) => BigInt(`0x${data.slice(2 + i * 64, 2 + (i + 1) * 64)}`);
  return { issuedAt: Number(word(0)), validUntil: Number(word(1)), recordHash: `0x${data.slice(2 + 128, 2 + 192)}` as Hex };
}

/** A claim of the given topic by the given issuer on an identity, and whether it holds now. */
export async function claimOn(identity: Address, topic: Topic, issuer: Address): Promise<ClaimView> {
  const { s } = context();
  const [t, , iss, sig, data] = await s.publicClient.readContract({ address: identity, abi: IDENTITY, functionName: "getClaim", args: [claimId(issuer, TOPIC[topic])] });
  const empty: ClaimView = { topic, issuer, present: false, valid: false, revoked: false, issuedAt: 0, validUntil: 0, recordHash: null, signature: null };
  if (t === 0n || iss.toLowerCase() !== issuer.toLowerCase()) return empty;
  const [valid, revoked] = await Promise.all([
    s.publicClient.readContract({ address: issuer, abi: ISSUER, functionName: "isClaimValid", args: [identity, TOPIC[topic], sig, data] }),
    s.publicClient.readContract({ address: issuer, abi: ISSUER, functionName: "isClaimRevoked", args: [sig] }),
  ]);
  const d = decodeData(data);
  return { ...empty, present: true, valid, revoked, issuedAt: d?.issuedAt ?? 0, validUntil: d?.validUntil ?? 0, recordHash: d?.recordHash ?? null, signature: sig };
}

/** Every claim of an identity, as each institution's issuer holds them. */
export async function claimsOf(identity: Address): Promise<Record<Topic, ClaimView>> {
  const v = vouchers();
  const [deposit, note, pool] = await Promise.all((["deposit", "note", "pool"] as const).map((t) => claimOn(identity, t, v[t].issuer)));
  return { deposit, note, pool };
}

/** Whether a wallet may hold the deposit and the main note, and use the conversion pool, now. */
export async function eligibility(wallet: Address): Promise<{ deposit: boolean; note: boolean; pool: boolean }> {
  const { m, id, s } = context();
  const read = (registry: Address) => s.publicClient.readContract({ address: registry, abi: REGISTRY, functionName: "isVerified", args: [wallet] });
  const [deposit, note, pool] = await Promise.all([
    read(id.depositRegistry),
    m.noteSuite ? read(m.noteSuite.identityRegistry) : Promise.resolve(false),
    poolStanding(wallet).then((st) => st === "admitted"),
  ]);
  return { deposit, note, pool };
}

/** What the conversion pool's gate says of a wallet now (ADR 0090); null where there is no pool. */
export async function poolStanding(wallet: Address): Promise<Standing | null> {
  const { m, s } = context();
  if (!m.venue) return null;
  const k = await s.publicClient.readContract({ address: m.venue.credentialGate, abi: POOL_GATE, functionName: "standing", args: [wallet] });
  return STANDING[k] ?? null;
}

/** Whether an institution holds a claim key on an identity: the client's consent to it vouching. */
export async function consented(identity: Address, institution: Address): Promise<boolean> {
  const { s } = context();
  const purposes = await s.publicClient.readContract({ address: identity, abi: IDENTITY, functionName: "getKeyPurposes", args: [keyOf(institution)] });
  return purposes.includes(CLAIM);
}

/** Who manages an identity: whether the given address holds a management key on it. */
export async function manages(identity: Address, who: Address): Promise<boolean> {
  const { s } = context();
  return s.publicClient.readContract({ address: identity, abi: IDENTITY, functionName: "keyHasPurpose", args: [keyOf(who), MANAGEMENT] });
}

// --- writes ---

/**
 * The bank creates a client's identity, managed by `manager`, and registers the wallet against it
 * in the shared storage. Returns the identity, or the one the wallet already has.
 */
export async function createIdentity(wallet: Address, manager: Address, salt: string): Promise<Address> {
  const { id, s } = context();
  const existing = await identityOf(wallet);
  if (existing) return existing;
  // A wallet offboarded earlier keeps its identity at the factory: it is registered again, not recreated.
  const known = await s.publicClient.readContract({ address: id.idFactory, abi: ID_FACTORY, functionName: "getIdentity", args: [wallet] });
  if (!/^0x0{40}$/i.test(known)) {
    await register(wallet, known);
    return known;
  }
  const args = [wallet, salt, [keyOf(manager)]] as const;
  const { result: identity } = await s.publicClient.simulateContract({ account: s.address("depositAgent"), address: id.idFactory, abi: ID_FACTORY, functionName: "createIdentityWithManagementKeys", args });
  await s.send("depositAgent", { address: id.idFactory, abi: ID_FACTORY, functionName: "createIdentityWithManagementKeys", args });
  await register(wallet, identity);
  return identity;
}

/** The identity's manager records the client's consent to an institution vouching for it. */
export async function consent(identity: Address, managerCapacity: string, institution: Address): Promise<void> {
  const { s } = context();
  // The claim purpose itself: a management key implies it, but the consent must outlast a hand-over.
  const purposes = await s.publicClient.readContract({ address: identity, abi: IDENTITY, functionName: "getKeyPurposes", args: [keyOf(institution)] });
  if (purposes.includes(CLAIM)) return;
  await s.send(managerCapacity, { address: identity, abi: IDENTITY, functionName: "addKey", args: [keyOf(institution), CLAIM, ECDSA] });
  // So the claim that follows is estimated against a chain that has the consent (ADR 0059).
  await until(() => s.publicClient.readContract({ address: identity, abi: IDENTITY, functionName: "getKeyPurposes", args: [keyOf(institution)] }), (p) => p.includes(CLAIM));
}

/**
 * An institution vouches: it signs a claim over the identity, the topic and the data (issued now,
 * lapsing in CLAIM_DAYS, or POOL_CLAIM_DAYS for the pool, with the hash of its own record), and
 * adds it to the identity. Returns the claim's signature, by which it can later be revoked.
 */
export async function vouch(identity: Address, topic: Topic, recordHash: Hex): Promise<{ signature: Hex; validUntil: number }> {
  const { s } = context();
  const { capacity, issuer } = vouchers()[topic];
  const block = await s.publicClient.getBlock();
  // Dated a few minutes back: a claim must not look issued in the future to a node a block behind
  // (ADR 0059), which is where the transaction is estimated.
  const issuedAt = Number(block.timestamp) - 300;
  const validUntil = issuedAt + (topic === "pool" ? POOL_CLAIM_DAYS : CLAIM_DAYS) * 86_400;
  const data = encodeAbiParameters([{ type: "uint48" }, { type: "uint48" }, { type: "bytes32" }], [issuedAt, validUntil, recordHash]);
  const digest = keccak256(encodeAbiParameters([{ type: "address" }, { type: "uint256" }, { type: "bytes" }], [identity, TOPIC[topic], data]));
  const signature = await s.signMessageHash(capacity, digest);
  await s.send(capacity, { address: identity, abi: IDENTITY, functionName: "addClaim", args: [TOPIC[topic], 1n, issuer, signature, data, ""] });
  await until(() => claimOn(identity, topic, issuer), (c) => c.valid);
  return { signature, validUntil };
}

/** The issuing institution revokes a claim at once. */
export async function revoke(topic: Topic, signature: Hex): Promise<void> {
  const { s } = context();
  const { capacity, issuer } = vouchers()[topic];
  const revoked = await s.publicClient.readContract({ address: issuer, abi: ISSUER, functionName: "isClaimRevoked", args: [signature] });
  if (revoked) return;
  await s.send(capacity, { address: issuer, abi: ISSUER, functionName: "revokeClaimBySignature", args: [signature] });
  // So what follows reads a chain that has the revocation (ADR 0059).
  await until(() => s.publicClient.readContract({ address: issuer, abi: ISSUER, functionName: "isClaimRevoked", args: [signature] }), (r) => r);
}

/** Hands a self-custody identity to its client (ADR 0089): the wallet becomes its manager, and the bank leaves. */
export async function handOver(identity: Address, wallet: Address): Promise<void> {
  const { s } = context();
  const bank = s.address("depositAgent");
  if (!(await manages(identity, wallet))) {
    await s.send("depositAgent", { address: identity, abi: IDENTITY, functionName: "addKey", args: [keyOf(wallet), MANAGEMENT, ECDSA] });
  }
  if (await manages(identity, bank)) {
    await s.send("depositAgent", { address: identity, abi: IDENTITY, functionName: "removeKey", args: [keyOf(bank), MANAGEMENT] });
  }
}

/**
 * Registers a wallet against an identity in the shared storage: by the bank through the deposit's
 * registry, or by the onboarding agent through the note's, each being its registry's agent.
 */
export async function register(wallet: Address, identity: Address, by: "bank" | "onboarding" = "bank"): Promise<void> {
  const { m, id, s } = context();
  if (await identityOf(wallet)) return;
  const registry = by === "bank" ? id.depositRegistry : m.noteSuite?.identityRegistry;
  if (!registry) throw new Error("the manifest has no note registry");
  await s.send(by === "bank" ? "depositAgent" : "accessIssuer", { address: registry, abi: REGISTRY, functionName: "registerIdentity", args: [wallet, identity, COUNTRY] });
  await until(() => identityOf(wallet), (v) => v !== null);
}

/** Removes a wallet from the shared storage: it is then known to no registry. */
export async function unregister(wallet: Address): Promise<void> {
  const { id, s } = context();
  if (!(await identityOf(wallet))) return;
  await s.send("depositAgent", { address: id.depositRegistry, abi: REGISTRY, functionName: "deleteIdentity", args: [wallet] });
}

/** A record as text with its keys sorted, so its hash survives storage that reorders keys. */
export function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (v && typeof v === "object") {
    return `{${Object.keys(v as object).sort().map((k) => `${JSON.stringify(k)}:${canonical((v as Record<string, unknown>)[k])}`).join(",")}}`;
  }
  return JSON.stringify(v ?? null);
}

/**
 * A salted hash of a record an institution keeps off-chain: what a claim carries (Q1). Anyone the
 * institution shows the record and salt to can check it; anyone else learns nothing from it.
 */
export function recordHash(record: unknown, salt: Hex): Hex {
  return keccak256(toBytes(`${salt}:${canonical(record)}`));
}
