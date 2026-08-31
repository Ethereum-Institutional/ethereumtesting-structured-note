import "server-only";
import { encodeAbiParameters, formatUnits, type Address, type Hex } from "viem";
import { publicClient, addresses, poolId, type Addresses } from "./chain";
import { STATE_VIEW_ABI, POSM_ABI, TREX_TOKEN_ABI, ERC20_ABI } from "./abis";

/**
 * Pool administration reads.
 *
 * Worth being precise about what is and is not controllable, because the question always comes
 * up. In Uniswap v4 a pool's fee, tick spacing and hook are part of its identity — they are set
 * at creation and cannot be changed; a different fee means a different pool. What the venue and
 * issuer control at runtime lives on the adapter and the compliance bridge: whether swapping is
 * enabled at all, which routers may touch the asset, which hook is trusted, and who is permitted
 * to trade or provide liquidity.
 *
 * There is also no order book anywhere: this is an AMM. Standing liquidity plays the role a book
 * plays on an exchange, with the price moving along the curve as swaps consume it.
 */

export type LpPosition = {
  tokenId: number;
  owner: Address;
  ownerLabel: string;
  liquidity: string;
  active: boolean;
};

export type PoolAdminState = {
  // Immutable identity
  fee: number;
  tickSpacing: number;
  hook: Address;
  // Live state
  priceUsdc: number;
  tick: number;
  activeLiquidity: string;
  // Runtime controls (read here, toggled in the console's Controls panel)
  swappingEnabled: boolean;
  // Standing liquidity
  positions: LpPosition[];
  // Treasury inventory available to deploy
  treasuryUnits: string;
  treasuryCash: string;
  // The range new treasury liquidity is minted into (the pool's seeded range)
  range: { tickLower: number; tickUpper: number };
};

function labelFor(a: Addresses, owner: Address): string {
  const map: Array<[string | undefined, string]> = [
    [a.treasury?.account, "Fund treasury"],
    [a.custody?.["CLIENT-A"], "Sakura Asset Management"],
    [a.custody?.["CLIENT-B"], "Lion City Family Office"],
    [a.custody?.["CLIENT-C"], "Harbour Retail Nominee"],
    [a.investors?.find((i) => i.name === "Alice")?.wallet, "Alice (seed LP)"],
  ];
  for (const [addr, label] of map) {
    if (addr && addr.toLowerCase() === owner.toLowerCase()) return label;
  }
  return `${owner.slice(0, 6)}…${owner.slice(-4)}`;
}

export async function poolAdminState(): Promise<PoolAdminState> {
  const a = addresses();
  const id = poolId(a);
  const assetIsCurrency0 = a.pool.currency0.toLowerCase() === a.venue.permissionsAdapter.toLowerCase();

  const [slot0, liquidity, swappingEnabled, nextId, treasuryUnits, treasuryCash] = await Promise.all([
    publicClient.readContract({ address: a.lens.stateView, abi: STATE_VIEW_ABI, functionName: "getSlot0", args: [id] }) as Promise<any>,
    publicClient.readContract({ address: a.lens.stateView, abi: STATE_VIEW_ABI, functionName: "getLiquidity", args: [id] }) as Promise<bigint>,
    publicClient.readContract({ address: a.venue.permissionsAdapter, abi: [{ type: "function", name: "swappingEnabled", inputs: [], outputs: [{ type: "bool" }], stateMutability: "view" }] as const, functionName: "swappingEnabled" }) as Promise<boolean>,
    publicClient.readContract({ address: a.venue.positionManager, abi: POSM_ABI, functionName: "nextTokenId" }) as Promise<bigint>,
    a.treasury?.account
      ? (publicClient.readContract({ address: a.trex.token, abi: TREX_TOKEN_ABI, functionName: "balanceOf", args: [a.treasury.account] }) as Promise<bigint>)
      : Promise.resolve(0n),
    a.treasury?.account
      ? (publicClient.readContract({ address: a.venue.usdc, abi: ERC20_ABI, functionName: "balanceOf", args: [a.treasury.account] }) as Promise<bigint>)
      : Promise.resolve(0n),
  ]);

  // Positions are enumerated straight from the chain: token ids are sequential from 1, so the
  // NFT contract itself is the registry. A burned (unwound) position has no owner and is skipped.
  const positions: LpPosition[] = [];
  const last = Number(nextId) - 1;
  for (let tokenId = 1; tokenId <= last && tokenId <= 50; tokenId++) {
    try {
      const owner = (await publicClient.readContract({
        address: a.venue.positionManager, abi: POSM_ABI, functionName: "ownerOf", args: [BigInt(tokenId)],
      })) as Address;
      const liq = (await publicClient.readContract({
        address: a.venue.positionManager, abi: POSM_ABI, functionName: "getPositionLiquidity", args: [BigInt(tokenId)],
      })) as bigint;
      positions.push({
        tokenId,
        owner,
        ownerLabel: labelFor(a, owner),
        liquidity: formatUnits(liq, 18),
        active: liq > 0n,
      });
    } catch {
      /* burned or never minted */
    }
  }

  const sqrtPriceX96 = BigInt(slot0[0]);
  const sqrt = Number(sqrtPriceX96) / 2 ** 96;
  const rawRatio = sqrt * sqrt;
  const priceUsdc = assetIsCurrency0 ? rawRatio * 1e12 : (1 / rawRatio) * 1e-12;

  return {
    fee: Number(slot0[3]),
    tickSpacing: a.pool.tickSpacing,
    hook: a.pool.hook,
    priceUsdc,
    tick: Number(slot0[1]),
    activeLiquidity: formatUnits(liquidity, 18),
    swappingEnabled,
    positions,
    treasuryUnits: formatUnits(treasuryUnits, a.trex.decimals),
    treasuryCash: formatUnits(treasuryCash, 6),
    range: { tickLower: a.pool.tickLower, tickUpper: a.pool.tickUpper },
  };
}

/**
 * Encodes a MINT_POSITION + SETTLE_PAIR plan for the position manager — the same plan the seed
 * script uses, so treasury liquidity lands in the pool's standing range.
 *
 * Liquidity from amounts uses the standard concentrated-liquidity formulas. Floats are fine here:
 * the computed figure is only a target, minted against amount caps that bound what can actually
 * be spent, and it is haircut slightly so rounding can never push the settle over those caps.
 */
export function buildMintLiquidityPlan(
  a: Addresses,
  assetUnits: number,
  cashUsdc: number,
): { unlockData: Hex; liquidity: bigint } {
  const assetIsCurrency0 = a.pool.currency0.toLowerCase() === a.venue.permissionsAdapter.toLowerCase();
  const { tickLower, tickUpper } = a.pool;

  const sqrtAt = (tick: number) => Math.pow(1.0001, tick / 2);
  // Recover the current sqrt from the configured opening price rather than reading slot0: the
  // caller passes both amounts, and the caps protect against drift either way.
  const sqrtL = sqrtAt(tickLower);
  const sqrtU = sqrtAt(tickUpper);
  const sqrtC = Math.sqrt((assetIsCurrency0 ? 100 : 1 / 100) * (assetIsCurrency0 ? 1e-12 : 1e12));

  const amount0 = assetIsCurrency0 ? assetUnits * 1e18 : cashUsdc * 1e6;
  const amount1 = assetIsCurrency0 ? cashUsdc * 1e6 : assetUnits * 1e18;

  const L0 = (amount0 * (sqrtU * sqrtC)) / (sqrtU - sqrtC);
  const L1 = amount1 / (sqrtC - sqrtL);
  const liquidity = BigInt(Math.floor(Math.min(L0, L1) * 0.995));
  if (liquidity <= 0n) throw new Error("Amounts are too small to mint any liquidity.");

  const amount0Max = BigInt(Math.ceil(amount0));
  const amount1Max = BigInt(Math.ceil(amount1));

  const MINT_POSITION = 0x02;
  const SETTLE_PAIR = 0x0d;
  const actions = `0x${[MINT_POSITION, SETTLE_PAIR].map((b) => b.toString(16).padStart(2, "0")).join("")}` as Hex;

  const POOL_KEY = [
    { name: "currency0", type: "address" },
    { name: "currency1", type: "address" },
    { name: "fee", type: "uint24" },
    { name: "tickSpacing", type: "int24" },
    { name: "hooks", type: "address" },
  ] as const;

  const mintParams = encodeAbiParameters(
    [
      { type: "tuple", components: POOL_KEY },
      { type: "int24" },
      { type: "int24" },
      { type: "uint256" },
      { type: "uint128" },
      { type: "uint128" },
      { type: "address" },
      { type: "bytes" },
    ],
    [
      {
        currency0: a.pool.currency0,
        currency1: a.pool.currency1,
        fee: a.pool.fee,
        tickSpacing: a.pool.tickSpacing,
        hooks: a.pool.hook,
      },
      tickLower,
      tickUpper,
      liquidity,
      amount0Max,
      amount1Max,
      a.treasury!.account,
      "0x",
    ] as any,
  );
  const settleParams = encodeAbiParameters(
    [{ type: "address" }, { type: "address" }],
    [a.pool.currency0, a.pool.currency1],
  );

  const unlockData = encodeAbiParameters(
    [{ type: "bytes" }, { type: "bytes[]" }],
    [actions, [mintParams, settleParams]],
  );
  return { unlockData, liquidity };
}
