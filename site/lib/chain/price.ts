import { formatUnits, type Address } from "viem";
import type { PoolKey, Token } from "./manifest.ts";

/**
 * Pool price, in one place.
 *
 * sqrtPriceX96 is sqrt(currency1 base units per currency0 base unit) in Q64.96. Which token is
 * currency0 depends on the addresses, and the two tokens' decimals differ, so neither the order
 * nor the decimal gap is assumed: both come from the pool key and the manifest.
 *
 * The arithmetic is exact in bigint and truncates toward zero at the 18th decimal place.
 */

const Q192 = 1n << 192n;
const SCALE = 18;

/**
 * Units of `quote` per whole unit of `base`, as a decimal string.
 *
 * `base` and `quote` are the two sides of the pool as the reader wants to see them, which is
 * independent of their order in the pool. A permissioned side is quoted through its adapter,
 * which carries the underlying token's decimals.
 */
export function price(
  sqrtPriceX96: bigint,
  key: PoolKey,
  base: { address: Address; decimals: number },
  quote: { address: Address; decimals: number },
): string {
  const baseIs0 = same(key.currency0, base.address);
  if (!baseIs0 && !same(key.currency1, base.address)) throw new Error("base is not a currency of this pool");
  if (!same(baseIs0 ? key.currency1 : key.currency0, quote.address)) {
    throw new Error("quote is not the other currency of this pool");
  }
  const sq = sqrtPriceX96 * sqrtPriceX96;
  const scale = 10n ** BigInt(SCALE);
  // currency1 per currency0, in whole units: sq / 2^192 * 10^(decimals0 - decimals1).
  const [d0, d1] = baseIs0 ? [base.decimals, quote.decimals] : [quote.decimals, base.decimals];
  const scaled = baseIs0
    ? (sq * scale * 10n ** BigInt(d0)) / (Q192 * 10n ** BigInt(d1))
    : (Q192 * scale * 10n ** BigInt(d1)) / (sq * 10n ** BigInt(d0));
  return formatUnits(scaled, SCALE);
}

/** The same, with the permissioned side named by its token and quoted through its adapter. */
export function priceOfAsset(sqrtPriceX96: bigint, key: PoolKey, adapter: Address, asset: Token, cash: Token): string {
  return price(sqrtPriceX96, key, { address: adapter, decimals: asset.decimals }, cash);
}

function same(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}
