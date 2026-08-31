import "server-only";
import { encodeAbiParameters, parseUnits, toFunctionSelector, type Address, type Hex } from "viem";
import type { Addresses } from "./chain";

/** v4-periphery Actions */
const SWAP_EXACT_IN_SINGLE = 0x06;
const SETTLE_ALL = 0x0c;
const TAKE_ALL = 0x0f;

const POOL_KEY = {
  name: "poolKey",
  type: "tuple",
  components: [
    { name: "currency0", type: "address" },
    { name: "currency1", type: "address" },
    { name: "fee", type: "uint24" },
    { name: "tickSpacing", type: "int24" },
    { name: "hooks", type: "address" },
  ],
} as const;

const EXACT_IN_SINGLE = {
  type: "tuple",
  components: [
    POOL_KEY,
    { name: "zeroForOne", type: "bool" },
    { name: "amountIn", type: "uint128" },
    { name: "amountOutMinimum", type: "uint128" },
    { name: "minHopPriceX36", type: "uint256" },
    { name: "hookData", type: "bytes" },
  ],
} as const;

export type Direction = "buy" | "sell";

/**
 * Builds the encoded action plan for a single-hop exact-input swap.
 *
 * "buy" spends USDC to acquire the permissioned asset; "sell" is the reverse. Direction is
 * resolved against the pool's currency ordering rather than assumed.
 */
export function buildSwap(a: Addresses, direction: Direction, amount: string) {
  const assetIsCurrency0 = a.pool.currency0.toLowerCase() === a.venue.permissionsAdapter.toLowerCase();
  const cash = a.venue.usdc.toLowerCase();
  const cashIsCurrency0 = a.pool.currency0.toLowerCase() === cash;

  // Spending cash means the input is whichever currency the stablecoin occupies.
  const inputIsCurrency0 = direction === "buy" ? cashIsCurrency0 : assetIsCurrency0;
  const zeroForOne = inputIsCurrency0;

  const currencyIn = inputIsCurrency0 ? a.pool.currency0 : a.pool.currency1;
  const currencyOut = inputIsCurrency0 ? a.pool.currency1 : a.pool.currency0;

  // Cash carries 6 decimals, the asset 18.
  const inDecimals = direction === "buy" ? 6 : a.trex.decimals;
  const amountIn = parseUnits(amount, inDecimals);

  const actions = `0x${[SWAP_EXACT_IN_SINGLE, SETTLE_ALL, TAKE_ALL]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")}` as Hex;

  const swapParams = encodeAbiParameters(
    [EXACT_IN_SINGLE],
    [
      {
        poolKey: {
          currency0: a.pool.currency0,
          currency1: a.pool.currency1,
          fee: a.pool.fee,
          tickSpacing: a.pool.tickSpacing,
          hooks: a.pool.hook,
        },
        zeroForOne,
        amountIn,
        amountOutMinimum: 0n,
        minHopPriceX36: 0n,
        hookData: "0x",
      },
    ] as any,
  );

  const settle = encodeAbiParameters([{ type: "address" }, { type: "uint256" }], [currencyIn, amountIn]);
  const take = encodeAbiParameters([{ type: "address" }, { type: "uint256" }], [currencyOut, 0n]);

  const unlockData = encodeAbiParameters(
    [{ type: "bytes" }, { type: "bytes[]" }],
    [actions, [swapParams, settle, take]],
  );

  return { unlockData, amountIn, currencyIn: currencyIn as Address, currencyOut: currencyOut as Address };
}

/**
 * Custom-error selectors mapped to plain language. The hook's revert is wrapped by
 * v4-core's CustomRevert before it surfaces, so match on the selector appearing anywhere
 * in the revert payload rather than trying to decode a known envelope.
 */
const HINTS: Array<[Hex, string]> = [
  [toFunctionSelector("NotAllowlisted(address,address,bytes2)"), "Blocked by the OpenZeppelin compliance hook: this wallet is not permitted for this action, per the issuer's T-REX identity registry."],
  [toFunctionSelector("SwappingDisabled(address)"), "Blocked: the issuer has switched trading off for this asset."],
  [toFunctionSelector("UnauthorizedRouter(address,address)"), "Blocked: this router is not an approved wrapper on the adapter."],
  [toFunctionSelector("UnverifiedPermissionsAdapter(address)"), "Blocked: the permissions adapter has not been verified."],
  [toFunctionSelector("NoPermissionsAdapter()"), "Blocked: neither side of this pool is a permissioned asset."],
  [toFunctionSelector("OriginatorUnavailable(address)"), "Blocked: the caller does not expose its originating wallet."],
];

export function explainRevert(err: unknown): string {
  const blob = JSON.stringify(
    err,
    (_k, v) => (typeof v === "bigint" ? v.toString() : v),
  ) + String((err as any)?.message ?? "") + String((err as any)?.details ?? "");

  // Not a revert at all: the transaction never confirmed. Calling this "Reverted" sent an
  // operator hunting for a compliance reason that does not exist.
  if (/timed out/i.test(blob)) {
    return "The transaction did not confirm in time. The stuck transaction was cleared automatically — press the button once more.";
  }

  for (const [selector, message] of HINTS) {
    if (blob.toLowerCase().includes(selector.slice(2).toLowerCase())) return message;
  }
  if (/paused/i.test(blob)) return "Blocked: the asset is paused by the issuer.";
  if (/frozen/i.test(blob)) return "Blocked: this wallet is frozen.";
  const short = (err as any)?.shortMessage;
  return short ? `Reverted: ${short}` : "Reverted (see server log for the raw trace).";
}
