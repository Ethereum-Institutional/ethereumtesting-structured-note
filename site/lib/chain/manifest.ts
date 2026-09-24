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
  venue: {
    poolManager: Address;
    permit2: Address;
    adapterFactory: Address;
    allowlistChecker: Address;
    hook: Address;
    router: Address;
    positionManager: Address;
    permissionsAdapter: Address;
    weth: Address;
  };
  pool: {
    currency0: Address;
    currency1: Address;
    fee: number;
    tickSpacing: number;
    tickLower: number;
    tickUpper: number;
    hook: Address;
  };
  lens?: { stateView: Address };
  custody?: { custodian: Address; factory: Address; accounts: Record<string, Address> };
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
  for (const k of [
    "poolManager", "permit2", "adapterFactory", "allowlistChecker",
    "hook", "router", "positionManager", "permissionsAdapter",
  ]) {
    needAddress(m, `venue.${k}`);
  }
  for (const k of ["currency0", "currency1", "hook"]) needAddress(m, `pool.${k}`);
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
export function poolKey(pool: Manifest["pool"]): PoolKey {
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
  const venue: Record<keyof Manifest["venue"], string> = {
    poolManager: "Pool manager",
    permit2: "Permit2",
    adapterFactory: "Adapter factory",
    allowlistChecker: "Checker",
    hook: "Compliance hook",
    router: "Router",
    positionManager: "Position manager",
    permissionsAdapter: "Permissions adapter",
    weth: "Wrapped ether",
  };
  for (const [key, label] of Object.entries(venue)) put(m.venue[key as keyof Manifest["venue"]], `venue.${key}`, label);
  put(m.lens?.stateView, "lens.stateView", "State lens");
  if (m.custody) {
    put(m.custody.factory, "custody.factory", "Custody factory");
    for (const [ref, addr] of Object.entries(m.custody.accounts)) put(addr, `custody.accounts.${ref}`, ref);
  }
  for (const [key, addr] of Object.entries(m.parties)) put(addr, `parties.${key}`, partyLabel(key));
  return book;
}

/** "investorA" reads as "Investor A"; a capacity reads with its capital. */
export function partyLabel(key: string): string {
  const m = /^([a-z]+)([A-Z])$/.exec(key);
  if (m) return `${m[1][0].toUpperCase()}${m[1].slice(1)} ${m[2]}`;
  return key[0].toUpperCase() + key.slice(1);
}
