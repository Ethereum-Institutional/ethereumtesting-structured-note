import { readFileSync } from "node:fs";
import { encodeAbiParameters, keccak256, type Address, type Hex } from "viem";

/**
 * The deployment manifest, as the deploy scripts write it to ops/addresses.json.
 *
 * Read from the file named by MANIFEST_PATH where there is one. MANIFEST_JSON carries the same
 * content where there is no file system to read, but a hosting environment variable has a size
 * ceiling that a manifest with several instruments will approach, so the file is preferred.
 *
 * Parsing checks every address the chain library relies on, so a stale or partial manifest
 * fails at load with the missing key named, rather than as a failed call later.
 */

export type Token = { address: Address; symbol: string; decimals: number };

export type Manifest = {
  chainId: number;
  parties: Record<string, Address>;
  assets: Record<string, Token>;
  /** The conversion pool (ADR 0090): deployed by default; absent where POOL=0 left it out. */
  venue?: {
    poolManager: Address;
    permit2: Address;
    adapterFactory: Address;
    allowlistChecker: Address;
    credentialGate: Address;
    hook: Address;
    router: Address;
    positionManager: Address;
    permissionsAdapter: Address;
    weth: Address;
  };
  pool?: {
    currency0: Address;
    currency1: Address;
    fee: number;
    tickSpacing: number;
    tickLower: number;
    tickUpper: number;
    hook: Address;
  };
  lens?: { stateView: Address };
  network?: { local: boolean; poolManager: Address; weth: Address };
  /** The shared scaffolding (ADR 0088): identities, T-REX, the claim issuers, the deposit's eligibility. */
  identity?: {
    idFactory: Address;
    trexFactory: Address;
    trexAuthority: Address;
    identityStorage: Address;
    bankIssuer: Address;
    onboardingIssuer: Address;
    depositRegistry: Address;
    depositTopics: Address;
    depositIssuers: Address;
    depositEligibleTopic: number | string;
    noteEligibleTopic: number | string;
    termSheetTopic: number | string;
    /** The pool's identity registry, read-only, and its topics and trusted issuers (ADR 0090). */
    poolRegistry?: Address;
    poolTopics?: Address;
    poolIssuers?: Address;
    poolAccessTopic?: number | string;
  };
  /** The main note's T-REX suite. */
  noteSuite?: { identityRegistry: Address; compliance: Address; trustedIssuers: Address; claimTopics: Address };
  custody?: {
    custodian: Address;
    factory: Address;
    accounts: Record<string, Address>;
    thirdParty?: { custodian: Address; factory: Address } & Record<string, Address>;
  };
  instruments?: {
    note: Address;
    deposit: Address;
    gateway: Address;
  };
  lifecycle?: {
    determinations: Address;
    recordDates: Address;
    payingAgent: Address;
    settlement: Address;
  };
  governance?: {
    controller: Address;
    walletFactory: Address;
    agentGovernance: Address;
    issuerGovernance: Address;
    cosigner: Address;
    servicingWallet: Address;
    tier2Delay: number;
    recoveryDelay: number;
    executionWindow?: number;
    targetTier2Delay?: number;
    targetExecutionWindow?: number;
  };
};

export type PoolKey = {
  currency0: Address;
  currency1: Address;
  fee: number;
  tickSpacing: number;
  hooks: Address;
};

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

export class ManifestError extends Error {}

function need(obj: unknown, path: string): unknown {
  let v: any = obj;
  for (const k of path.split(".")) {
    if (v == null || typeof v !== "object" || !(k in v)) throw new ManifestError(`manifest lacks ${path}`);
    v = v[k];
  }
  return v;
}

function needAddress(obj: unknown, path: string): void {
  const v = need(obj, path);
  if (typeof v !== "string" || !ADDRESS.test(v)) throw new ManifestError(`manifest ${path} is not an address`);
}

export function parseManifest(json: string): Manifest {
  const m = JSON.parse(json) as Manifest;
  if (typeof need(m, "chainId") !== "number") throw new ManifestError("manifest chainId is not a number");
  if (m.venue) {
    for (const k of [
      "poolManager", "permit2", "adapterFactory", "allowlistChecker", "credentialGate",
      "hook", "router", "positionManager", "permissionsAdapter",
    ]) {
      needAddress(m, `venue.${k}`);
    }
    for (const k of ["currency0", "currency1", "hook"]) needAddress(m, `pool.${k}`);
  }
  if (m.identity) for (const k of ["idFactory", "bankIssuer", "onboardingIssuer", "depositRegistry"]) needAddress(m, `identity.${k}`);
  for (const [key, token] of Object.entries(need(m, "assets") as Record<string, Token>)) {
    needAddress(token, "address");
    if (!Number.isInteger(token.decimals)) throw new ManifestError(`manifest assets.${key}.decimals is not an integer`);
  }
  for (const key of Object.keys(need(m, "parties") as object)) needAddress(m, `parties.${key}`);
  return m;
}

export function loadManifest(env: NodeJS.ProcessEnv = process.env): Manifest {
  if (env.MANIFEST_PATH) return parseManifest(readFileSync(env.MANIFEST_PATH, "utf8"));
  if (env.MANIFEST_JSON) return parseManifest(env.MANIFEST_JSON);
  throw new ManifestError("set MANIFEST_PATH to ops/addresses.json, or MANIFEST_JSON to its content");
}

/** The pool's key. Takes the pool, not the whole manifest, so a manifest can carry several. */
export function poolKey(pool: NonNullable<Manifest["pool"]>): PoolKey {
  return {
    currency0: pool.currency0,
    currency1: pool.currency1,
    fee: pool.fee,
    tickSpacing: pool.tickSpacing,
    hooks: pool.hook,
  };
}

/** PoolId is keccak256(abi.encode(poolKey)). */
export function poolId(key: PoolKey): Hex {
  return keccak256(
    encodeAbiParameters(
      [{ type: "address" }, { type: "address" }, { type: "uint24" }, { type: "int24" }, { type: "address" }],
      [key.currency0, key.currency1, key.fee, key.tickSpacing, key.hooks],
    ),
  );
}

/** The manifest's own names for every address it holds, for labelling. */
export function addressBook(m: Manifest): Map<string, { key: string; label: string }> {
  const book = new Map<string, { key: string; label: string }>();
  const put = (addr: string | undefined, key: string, label: string) => {
    if (addr && !book.has(addr.toLowerCase())) book.set(addr.toLowerCase(), { key, label });
  };
  for (const [key, t] of Object.entries(m.assets)) put(t.address, `assets.${key}`, t.symbol);
  const venue: Record<keyof NonNullable<Manifest["venue"]>, string> = {
    poolManager: "Pool manager",
    permit2: "Permit2",
    adapterFactory: "Adapter factory",
    allowlistChecker: "Checker",
    credentialGate: "Pool gate",
    hook: "Compliance hook",
    router: "Router",
    positionManager: "Position manager",
    permissionsAdapter: "Permissions adapter",
    weth: "Wrapped ether",
  };
  if (m.venue) for (const [key, label] of Object.entries(venue)) put(m.venue[key as keyof typeof venue], `venue.${key}`, label);
  put(m.lens?.stateView, "lens.stateView", "State lens");
  if (m.identity) {
    put(m.identity.idFactory, "identity.idFactory", "Identity factory");
    put(m.identity.trexFactory, "identity.trexFactory", "T-REX factory");
    put(m.identity.trexAuthority, "identity.trexAuthority", "T-REX implementations (fixed)");
    put(m.identity.identityStorage, "identity.identityStorage", "Identity storage");
    put(m.identity.bankIssuer, "identity.bankIssuer", "The bank's claim issuer");
    put(m.identity.onboardingIssuer, "identity.onboardingIssuer", "The onboarding agent's claim issuer");
    put(m.identity.depositRegistry, "identity.depositRegistry", "Deposit identity registry");
    put(m.identity.depositTopics, "identity.depositTopics", "Deposit claim topics");
    put(m.identity.depositIssuers, "identity.depositIssuers", "Deposit trusted issuers");
    put(m.identity.poolRegistry, "identity.poolRegistry", "Pool identity registry");
    put(m.identity.poolTopics, "identity.poolTopics", "Pool claim topics");
    put(m.identity.poolIssuers, "identity.poolIssuers", "Pool trusted issuers");
  }
  if (m.noteSuite) {
    put(m.noteSuite.identityRegistry, "noteSuite.identityRegistry", "Note identity registry");
    put(m.noteSuite.compliance, "noteSuite.compliance", "Note compliance");
    put(m.noteSuite.trustedIssuers, "noteSuite.trustedIssuers", "Note trusted issuers");
    put(m.noteSuite.claimTopics, "noteSuite.claimTopics", "Note claim topics");
  }
  if (m.instruments) put(m.instruments.gateway, "instruments.gateway", "Deposit gateway");
  if (m.lifecycle) {
    put(m.lifecycle.determinations, "lifecycle.determinations", "Determination Agent");
    put(m.lifecycle.recordDates, "lifecycle.recordDates", "Record-date module");
    put(m.lifecycle.payingAgent, "lifecycle.payingAgent", "Paying Agent");
    put(m.lifecycle.settlement, "lifecycle.settlement", "Locked settlement");
  }
  if (m.governance) {
    put(m.governance.controller, "governance.controller", "Governance controller");
    put(m.governance.walletFactory, "governance.walletFactory", "Wallet factory");
    put(m.governance.agentGovernance, "governance.agentGovernance", "Agent governance wallet");
    put(m.governance.issuerGovernance, "governance.issuerGovernance", "Issuer governance wallet");
    put(m.governance.cosigner, "governance.cosigner", "Co-signer wallet");
    put(m.governance.servicingWallet, "governance.servicingWallet", "Agent servicing wallet");
  }
  if (m.custody) {
    put(m.custody.factory, "custody.factory", "Bank custody factory");
    for (const [ref, addr] of Object.entries(m.custody.accounts)) put(addr, `custody.accounts.${ref}`, ref);
    if (m.custody.thirdParty) {
      put(m.custody.thirdParty.factory, "custody.thirdParty.factory", "Third-party custody factory");
      for (const [ref, addr] of Object.entries(m.custody.thirdParty)) if (!["factory", "custodian"].includes(ref)) put(addr, `custody.thirdParty.${ref}`, ref);
    }
  }
  for (const [key, addr] of Object.entries(m.parties)) put(addr, `parties.${key}`, partyLabel(key));
  return book;
}

/** Capacities whose manifest key does not read as their name (ADR 0089). */
const PARTY_NAMES: Record<string, string> = {
  accessIssuer: "Onboarding agent",
  onboardingAgent: "Onboarding agent",
  depositAgent: "The bank (Deposit Agent)",
  custodian: "Bank custody platform",
  thirdPartyCustodian: "Third-party custodian",
};

/** A manifest key read as a capacity: "investorA" is "Investor A", "onboardingAgent" is "Onboarding agent". */
export function partyLabel(key: string): string {
  if (PARTY_NAMES[key]) return PARTY_NAMES[key];
  const words = key.replace(/([A-Z])/g, " $1").trim();
  return words[0].toUpperCase() + words.slice(1);
}
