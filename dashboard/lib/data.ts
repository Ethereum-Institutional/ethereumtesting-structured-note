import "server-only";
import { formatUnits, type Address } from "viem";
import {
  publicClient,
  addresses,
  poolId,
  decodeFlags,
  priceFromSqrt,
  COUNTRY_NAMES,
  type Addresses,
} from "./chain";
import {
  TREX_TOKEN_ABI,
  IDENTITY_REGISTRY_ABI,
  ID_FACTORY_ABI,
  CHECKER_ABI,
  ADAPTER_ABI,
  ERC20_ABI,
  STATE_VIEW_ABI,
  MODULAR_COMPLIANCE_ABI,
  DEMO_BASELINE_ABI,
} from "./abis";

const ZERO = "0x0000000000000000000000000000000000000000" as Address;

export type HolderRow = {
  /** Actor id the trade action uses: a role name for direct holders, a client ref for custodied ones. */
  actor: string;
  custody: string; // "Self-custody" or the custodian's name
  name: string;
  wallet: Address;
  identity: Address;
  country: number;
  countryName: string;
  claims: number[];
  assetBalance: string;
  cashBalance: string;
  frozen: boolean;
  frozenTokens: string;
  verified: boolean;
  registered: boolean;
  canSwap: boolean;
  canProvideLiquidity: boolean;
  gate: string; // the first gate that fails, or "clear"
};

export type Snapshot = {
  a: Addresses;
  asset: {
    name: string;
    symbol: string;
    decimals: number;
    totalSupply: string;
    paused: boolean;
  };
  venue: {
    swappingEnabled: boolean;
    wrappedSupply: string;
    adapterAssetBalance: string;
    enforceCountry: boolean;
    liquidityClaimTopic: number;
    countries: Array<{ code: number; name: string; allowed: boolean }>;
  };
  pool: {
    sqrtPriceX96: string;
    tick: number;
    lpFee: number;
    liquidity: string;
    priceUsdc: number;
    assetIsCurrency0: boolean;
    /** Real reserves held by the PoolManager — what "depth" means to a person. */
    depthAsset: string;
    depthCash: string;
  };
  holders: HolderRow[];
  custody: { name: string; operator: Address; factory: Address; clientCount: number };
  servicing: {
    baselineArmed: boolean;
    maxBalanceBound: boolean;
    /** Custody clients deployed and funded but not yet KYC'd — onboardable live. */
    pending: Array<{ ref: string; name: string; account: Address }>;
  };
};

/** The first failing gate, in the order the checker applies them. */
function firstFailingGate(e: {
  registeredAsset: boolean;
  assetPaused: boolean;
  walletFrozen: boolean;
  identityVerified: boolean;
  countryPermitted: boolean;
}): string {
  if (!e.registeredAsset) return "asset not registered at venue";
  if (e.assetPaused) return "asset paused by issuer";
  if (e.walletFrozen) return "wallet frozen by agent";
  if (!e.identityVerified) return "identity not verified";
  if (!e.countryPermitted) return "jurisdiction blocked at venue";
  return "clear";
}

/**
 * Reads everything the console displays, or reports why it cannot.
 *
 * A hosted deployment can outlive the chain it points at, so an unreachable RPC or a missing
 * manifest is an expected state rather than a crash. The page renders setup guidance instead.
 */
export async function trySnapshot(): Promise<{ data: Snapshot | null; reason: string | null }> {
  try {
    return { data: await snapshot(), reason: null };
  } catch (err: any) {
    return { data: null, reason: unreachableReason(err) };
  }
}

function unreachableReason(err: any): string {
  const msg = String(err?.shortMessage ?? err?.message ?? err);
  return /ENOENT|no such file/i.test(msg)
    ? "No deployment manifest. Set ADDRESSES_JSON, or run ops/reset.sh locally."
    : /fetch failed|ECONNREFUSED|socket|timeout|HTTP request failed/i.test(msg)
      ? `Cannot reach the chain at ${process.env.RPC_URL ?? "http://127.0.0.1:8545"}.`
      : msg.slice(0, 300);
}

/**
 * The handful of reads the console shell needs for its header badges — the console is split
 * into one-job pages, and fetching the full snapshot in the shared layout would double every
 * page's chain traffic for the sake of four booleans.
 */
export type StatusStrip = {
  custodianName: string;
  assetName: string;
  symbol: string;
  paused: boolean;
  swappingEnabled: boolean;
  enforceCountry: boolean;
  baselineArmed: boolean;
  chainId: number;
};

export async function tryStatusStrip(): Promise<{ data: StatusStrip | null; reason: string | null }> {
  try {
    const a = addresses();
    const [paused, swappingEnabled, policy, baselineArmed] = await Promise.all([
      publicClient.readContract({ address: a.trex.token, abi: TREX_TOKEN_ABI, functionName: "paused" }),
      publicClient.readContract({ address: a.venue.permissionsAdapter, abi: ADAPTER_ABI, functionName: "swappingEnabled" }),
      publicClient.readContract({ address: a.venue.allowlistChecker, abi: CHECKER_ABI, functionName: "policyOf", args: [a.trex.token] }),
      a.ops?.demoBaseline
        ? (publicClient.readContract({ address: a.ops.demoBaseline, abi: DEMO_BASELINE_ABI, functionName: "isArmed" }) as Promise<boolean>)
        : Promise.resolve(false),
    ]);
    return {
      data: {
        custodianName: a.custody?.custodianName ?? "Custodian",
        assetName: a.trex.tokenName,
        symbol: a.trex.tokenSymbol,
        paused: paused as boolean,
        swappingEnabled: swappingEnabled as boolean,
        enforceCountry: (policy as any)[3],
        baselineArmed,
        chainId: a.chainId,
      },
      reason: null,
    };
  } catch (err: any) {
    return { data: null, reason: unreachableReason(err) };
  }
}

/** The market page's reads: price, real reserves, and whether the gate is open. */
export type MarketState = {
  symbol: string;
  priceUsdc: number;
  depthAsset: string;
  depthCash: string;
  lpFee: number;
  swappingEnabled: boolean;
  paused: boolean;
};

export async function marketState(): Promise<MarketState> {
  const a = addresses();
  const id = poolId(a);
  const assetIsCurrency0 = a.pool.currency0.toLowerCase() === a.venue.permissionsAdapter.toLowerCase();
  const [slot0, poolAsset, poolCash, swappingEnabled, paused] = await Promise.all([
    publicClient.readContract({ address: a.lens.stateView, abi: STATE_VIEW_ABI, functionName: "getSlot0", args: [id] }),
    publicClient.readContract({ address: a.venue.permissionsAdapter, abi: ERC20_ABI, functionName: "balanceOf", args: [a.venue.poolManager] }),
    publicClient.readContract({ address: a.venue.usdc, abi: ERC20_ABI, functionName: "balanceOf", args: [a.venue.poolManager] }),
    publicClient.readContract({ address: a.venue.permissionsAdapter, abi: ADAPTER_ABI, functionName: "swappingEnabled" }),
    publicClient.readContract({ address: a.trex.token, abi: TREX_TOKEN_ABI, functionName: "paused" }),
  ]);
  return {
    symbol: a.trex.tokenSymbol,
    priceUsdc: priceFromSqrt((slot0 as any)[0], assetIsCurrency0),
    depthAsset: formatUnits(poolAsset as bigint, a.trex.decimals),
    depthCash: formatUnits(poolCash as bigint, 6),
    lpFee: Number((slot0 as any)[3]),
    swappingEnabled: swappingEnabled as boolean,
    paused: paused as boolean,
  };
}

/** The controls page's reads: the levers' current state plus the country flags. */
export type ControlsState = {
  symbol: string;
  paused: boolean;
  swappingEnabled: boolean;
  enforceCountry: boolean;
  countries: Array<{ code: number; name: string; allowed: boolean }>;
  contracts: { token: string; checker: string; adapter: string; symbol: string };
};

export async function controlsState(): Promise<ControlsState> {
  const a = addresses();
  const countryCodes = [702, 344, 392, 36, 840];
  const [paused, swappingEnabled, policy, ...flags] = await Promise.all([
    publicClient.readContract({ address: a.trex.token, abi: TREX_TOKEN_ABI, functionName: "paused" }),
    publicClient.readContract({ address: a.venue.permissionsAdapter, abi: ADAPTER_ABI, functionName: "swappingEnabled" }),
    publicClient.readContract({ address: a.venue.allowlistChecker, abi: CHECKER_ABI, functionName: "policyOf", args: [a.trex.token] }),
    ...countryCodes.map((c) =>
      publicClient.readContract({ address: a.venue.allowlistChecker, abi: CHECKER_ABI, functionName: "isCountryAllowed", args: [a.trex.token, c] }),
    ),
  ]);
  return {
    symbol: a.trex.tokenSymbol,
    paused: paused as boolean,
    swappingEnabled: swappingEnabled as boolean,
    enforceCountry: (policy as any)[3],
    countries: countryCodes.map((code, i) => ({ code, name: COUNTRY_NAMES[code] ?? String(code), allowed: flags[i] as boolean })),
    contracts: { token: a.trex.token, checker: a.venue.allowlistChecker, adapter: a.venue.permissionsAdapter, symbol: a.trex.tokenSymbol },
  };
}

export async function snapshot(): Promise<Snapshot> {
  const a = addresses();
  const token = a.trex.token;
  const checker = a.venue.allowlistChecker;
  const id = poolId(a);
  const assetIsCurrency0 = a.pool.currency0.toLowerCase() === a.venue.permissionsAdapter.toLowerCase();

  const [name, symbol, decimals, totalSupply, paused] = await Promise.all([
    publicClient.readContract({ address: token, abi: TREX_TOKEN_ABI, functionName: "name" }),
    publicClient.readContract({ address: token, abi: TREX_TOKEN_ABI, functionName: "symbol" }),
    publicClient.readContract({ address: token, abi: TREX_TOKEN_ABI, functionName: "decimals" }),
    publicClient.readContract({ address: token, abi: TREX_TOKEN_ABI, functionName: "totalSupply" }),
    publicClient.readContract({ address: token, abi: TREX_TOKEN_ABI, functionName: "paused" }),
  ]);

  const [swappingEnabled, wrappedSupply, adapterAssetBalance, policy, slot0, liquidity, poolAsset, poolCash] = await Promise.all([
    publicClient.readContract({ address: a.venue.permissionsAdapter, abi: ADAPTER_ABI, functionName: "swappingEnabled" }),
    publicClient.readContract({ address: a.venue.permissionsAdapter, abi: ADAPTER_ABI, functionName: "totalSupply" }),
    publicClient.readContract({ address: token, abi: TREX_TOKEN_ABI, functionName: "balanceOf", args: [a.venue.permissionsAdapter] }),
    publicClient.readContract({ address: checker, abi: CHECKER_ABI, functionName: "policyOf", args: [token] }),
    publicClient.readContract({ address: a.lens.stateView, abi: STATE_VIEW_ABI, functionName: "getSlot0", args: [id] }),
    publicClient.readContract({ address: a.lens.stateView, abi: STATE_VIEW_ABI, functionName: "getLiquidity", args: [id] }),
    // The pool's real reserves: the wrapped asset and the stablecoin sitting in the PoolManager.
    // Uniswap's own `liquidity` figure is the L invariant — not a token amount — and reads as
    // nonsense next to a price, so the screen shows these instead.
    publicClient.readContract({ address: a.venue.permissionsAdapter, abi: ERC20_ABI, functionName: "balanceOf", args: [a.venue.poolManager] }),
    publicClient.readContract({ address: a.venue.usdc, abi: ERC20_ABI, functionName: "balanceOf", args: [a.venue.poolManager] }),
  ]);

  // Servicing state: is a reset baseline armed, and is the concentration limit in force?
  const [baselineArmed, maxBalanceBound] = await Promise.all([
    a.ops?.demoBaseline
      ? (publicClient.readContract({
          address: a.ops.demoBaseline,
          abi: DEMO_BASELINE_ABI,
          functionName: "isArmed",
        }) as Promise<boolean>)
      : Promise.resolve(false),
    publicClient.readContract({
      address: a.trex.modularCompliance,
      abi: MODULAR_COMPLIANCE_ABI,
      functionName: "isModuleBound",
      args: [a.trex.modules.maxBalance],
    }) as Promise<boolean>,
  ]);

  const countryCodes = [702, 344, 392, 36, 840];
  const countryFlags = await Promise.all(
    countryCodes.map((c) =>
      publicClient.readContract({ address: checker, abi: CHECKER_ABI, functionName: "isCountryAllowed", args: [token, c] }),
    ),
  );

  // Direct holders from the deploy manifest, plus the unverified control wallet, plus every
  // segregated custody client. One table: the compliance question is identical whoever holds.
  const custodianName = a.custody?.custodianName ?? "Custodian";
  const cast: Array<{ actor: string; custody: string; name: string; wallet: Address }> = [
    ...a.investors.map((i) => ({ actor: i.name, custody: "Self-custody", name: i.name, wallet: i.wallet })),
    { actor: "Dave", custody: "Self-custody", name: "Dave", wallet: a.roles.unverified },
    ...(a.custodyClients ?? []).map((c) => ({ actor: c.ref, custody: custodianName, name: c.name, wallet: c.account })),
    ...(a.custodyPending ?? []).map((c) => ({ actor: c.ref, custody: custodianName, name: c.name, wallet: c.account })),
  ];

  const holders: HolderRow[] = await Promise.all(
    cast.map(async (inv) => {
      // Everything on a row is a live read. The deploy manifest only supplies the cast list and
      // display names — identity, claims and country all come from the chain, so a client
      // onboarded or re-papered live shows its true state rather than what the deploy wrote.
      const [assetBal, cashBal, frozen, frozenTokens, verified, registered, explain, identity, country] = await Promise.all([
        publicClient.readContract({ address: token, abi: TREX_TOKEN_ABI, functionName: "balanceOf", args: [inv.wallet] }),
        publicClient.readContract({ address: a.venue.usdc, abi: ERC20_ABI, functionName: "balanceOf", args: [inv.wallet] }),
        publicClient.readContract({ address: token, abi: TREX_TOKEN_ABI, functionName: "isFrozen", args: [inv.wallet] }),
        publicClient.readContract({ address: token, abi: TREX_TOKEN_ABI, functionName: "getFrozenTokens", args: [inv.wallet] }),
        publicClient.readContract({ address: a.trex.identityRegistry, abi: IDENTITY_REGISTRY_ABI, functionName: "isVerified", args: [inv.wallet] }),
        publicClient.readContract({ address: a.trex.identityRegistry, abi: IDENTITY_REGISTRY_ABI, functionName: "contains", args: [inv.wallet] }),
        publicClient.readContract({ address: checker, abi: CHECKER_ABI, functionName: "explain", args: [inv.wallet, token] }),
        publicClient
          .readContract({ address: a.trex.idFactory, abi: ID_FACTORY_ABI, functionName: "getIdentity", args: [inv.wallet] })
          .catch(() => ZERO) as Promise<Address>,
        publicClient
          .readContract({ address: a.trex.identityRegistry, abi: IDENTITY_REGISTRY_ABI, functionName: "investorCountry", args: [inv.wallet] })
          .catch(() => 0) as Promise<number>,
      ]);

      const e = {
        registeredAsset: explain[0],
        assetPaused: explain[1],
        walletFrozen: explain[2],
        identityVerified: explain[3],
        countryPermitted: explain[4],
        holdsLiquidityClaim: explain[5],
        flags: explain[6],
      };
      const f = decodeFlags(e.flags);

      // Claim stamps from the checker's own explain(): the registry verifying the KYC claim is
      // what makes identityVerified true, and holdsLiquidityClaim is the accreditation topic.
      // Same on-chain truth as reading each identity contract, at two fewer reads per holder —
      // which matters when the RPC sits behind a tunnel.
      const claims: number[] = identity === ZERO
        ? []
        : [
            ...(e.identityVerified ? [a.topics.KYC] : []),
            ...(e.holdsLiquidityClaim ? [a.topics.PROFESSIONAL] : []),
          ];

      return {
        actor: inv.actor,
        custody: inv.custody,
        name: inv.name,
        wallet: inv.wallet,
        identity,
        country: Number(country),
        countryName: COUNTRY_NAMES[Number(country)] ?? "—",
        claims,
        assetBalance: formatUnits(assetBal as bigint, Number(decimals)),
        cashBalance: formatUnits(cashBal as bigint, 6),
        frozen: frozen as boolean,
        frozenTokens: formatUnits(frozenTokens as bigint, Number(decimals)),
        verified: verified as boolean,
        registered: registered as boolean,
        canSwap: f.swap,
        canProvideLiquidity: f.liquidity,
        gate: firstFailingGate(e),
      };
    }),
  );

  return {
    a,
    asset: {
      name: name as string,
      symbol: symbol as string,
      decimals: Number(decimals),
      totalSupply: formatUnits(totalSupply as bigint, Number(decimals)),
      paused: paused as boolean,
    },
    venue: {
      swappingEnabled: swappingEnabled as boolean,
      wrappedSupply: formatUnits(wrappedSupply as bigint, Number(decimals)),
      adapterAssetBalance: formatUnits(adapterAssetBalance as bigint, Number(decimals)),
      enforceCountry: (policy as any)[3],
      liquidityClaimTopic: Number((policy as any)[2]),
      countries: countryCodes.map((code, i) => ({
        code,
        name: COUNTRY_NAMES[code] ?? String(code),
        allowed: countryFlags[i] as boolean,
      })),
    },
    pool: {
      sqrtPriceX96: (slot0 as any)[0].toString(),
      tick: Number((slot0 as any)[1]),
      lpFee: Number((slot0 as any)[3]),
      liquidity: (liquidity as bigint).toString(),
      priceUsdc: priceFromSqrt((slot0 as any)[0], assetIsCurrency0),
      assetIsCurrency0,
      depthAsset: formatUnits(poolAsset as bigint, Number(decimals)),
      depthCash: formatUnits(poolCash as bigint, 6),
    },
    holders,
    servicing: {
      baselineArmed,
      maxBalanceBound,
      // Anything in the manifest as pending that the registry still does not contain.
      pending: (a.custodyPending ?? []).filter((c) =>
        holders.some((h) => h.wallet.toLowerCase() === c.account.toLowerCase() && !h.registered),
      ),
    },
    custody: {
      name: custodianName,
      operator: a.custody?.custodian,
      factory: a.custody?.factory,
      clientCount: (a.custodyClients ?? []).length + (a.custodyPending ?? []).length,
    },
  };
}
