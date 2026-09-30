/**
 * What the conversion pool gives for an exact input (ADR 0070), computed from the pool's state as
 * Uniswap v4 does within a single range: the pool holds one position, so no tick is crossed.
 * Pure, and exact to Uniswap's own rounding within a unit, which the 0.5% minimum-received
 * (enforced on-chain by the swap itself) absorbs.
 */

const Q96 = 1n << 96n;
const MAX_UINT256 = (1n << 256n) - 1n;

/** TickMath.getSqrtPriceAtTick, as in v4-core. */
export function sqrtPriceAtTick(tick: number): bigint {
  const abs = BigInt(Math.abs(tick));
  let ratio = abs & 0x1n ? 0xfffcb933bd6fad37aa2d162d1a594001n : 0x100000000000000000000000000000000n;
  const steps: Array<[bigint, bigint]> = [
    [0x2n, 0xfff97272373d413259a46990580e213an], [0x4n, 0xfff2e50f5f656932ef12357cf3c7fdccn],
    [0x8n, 0xffe5caca7e10e4e61c3624eaa0941cd0n], [0x10n, 0xffcb9843d60f6159c9db58835c926644n],
    [0x20n, 0xff973b41fa98c081472e6896dfb254c0n], [0x40n, 0xff2ea16466c96a3843ec78b326b52861n],
    [0x80n, 0xfe5dee046a99a2a811c461f1969c3053n], [0x100n, 0xfcbe86c7900a88aedcffc83b479aa3a4n],
    [0x200n, 0xf987a7253ac413176f2b074cf7815e54n], [0x400n, 0xf3392b0822b70005940c7a398e4b70f3n],
    [0x800n, 0xe7159475a2c29b7443b29c7fa6e889d9n], [0x1000n, 0xd097f3bdfd2022b8845ad8f792aa5825n],
    [0x2000n, 0xa9f746462d870fdf8a65dc1f90e061e5n], [0x4000n, 0x70d869a156d2a1b890bb3df62baf32f7n],
    [0x8000n, 0x31be135f97d08fd981231505542fcfa6n], [0x10000n, 0x9aa508b5b7a84e1c677de54f3e99bc9n],
    [0x20000n, 0x5d6af8dedb81196699c329225ee604n], [0x40000n, 0x2216e584f5fa1ea926041bedfe98n],
    [0x80000n, 0x48a170391f7dc42444e8fa2n],
  ];
  for (const [bit, factor] of steps) if (abs & bit) ratio = (ratio * factor) >> 128n;
  if (tick > 0) ratio = MAX_UINT256 / ratio;
  return (ratio >> 32n) + (ratio % (1n << 32n) === 0n ? 0n : 1n);
}

export type PoolState = { sqrtPriceX96: bigint; liquidity: bigint; tickLower: number; tickUpper: number; fee: number };

/**
 * The output for `amountIn` of currency0 (zeroForOne) or currency1, after the pool's fee (in
 * hundredths of a basis point). Throws if the swap would leave the pool's range.
 */
export function quoteExactIn(p: PoolState, amountIn: bigint, zeroForOne: boolean): bigint {
  if (amountIn <= 0n) throw new Error("the amount must be more than zero");
  if (p.liquidity <= 0n) throw new Error("the pool has no liquidity");
  const afterFee = (amountIn * BigInt(1_000_000 - p.fee)) / 1_000_000n;
  const L = p.liquidity;
  const s = p.sqrtPriceX96;
  if (zeroForOne) {
    // Price falls: next = L·s / (L + in·s / Q96), rounded up as v4 does.
    const num = (L << 96n) * s;
    const den = (L << 96n) + afterFee * s;
    const next = (num + den - 1n) / den;
    if (next < sqrtPriceAtTick(p.tickLower)) throw new Error("that is more than the pool can take in one conversion");
    return (L * (s - next)) / Q96;
  }
  // Price rises: next = s + in·Q96 / L, rounded down.
  const next = s + (afterFee << 96n) / L;
  if (next > sqrtPriceAtTick(p.tickUpper)) throw new Error("that is more than the pool can take in one conversion");
  return ((L << 96n) * (next - s)) / next / s;
}

/** The least the swap may deliver: the quote less the tolerance, in basis points (50 = 0.5%). */
export function minimumReceived(quote: bigint, toleranceBps = 50): bigint {
  return (quote * BigInt(10_000 - toleranceBps)) / 10_000n;
}
