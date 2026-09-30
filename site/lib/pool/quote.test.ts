import { test } from "node:test";
import assert from "node:assert/strict";
import { minimumReceived, quoteExactIn, sqrtPriceAtTick } from "./quote.ts";

test("sqrt prices at ticks match v4-core's TickMath", () => {
  assert.equal(sqrtPriceAtTick(0), 1n << 96n);
  assert.equal(sqrtPriceAtTick(1), 79232123823359799118286999568n);
  assert.equal(sqrtPriceAtTick(-887272), 4295128739n);
  assert.equal(sqrtPriceAtTick(887272), 1461446703485210103287273052203988822378723970342n);
});

// The live pool on the test network: EURC (6 decimals) against the deposit (2), at par, fee 0.05%.
const LIVE = { sqrtPriceX96: 792281625142643375935439503n, liquidity: 69058535n, tickLower: -92150, tickUpper: -92050, fee: 500 };

test("a conversion near par gives about the same, less the fee and a little price impact", () => {
  const cents = quoteExactIn(LIVE, 1_000_000n, true); // 1 EURC in
  assert.ok(cents >= 99n && cents <= 100n, `1 EURC gives ${cents} cents`);
  const micro = quoteExactIn(LIVE, 1_000n, false); // 10 EURTD in
  // Half the live pool's depth, so the price impact shows: still well inside the 0.5% limit.
  assert.ok(micro > 9_950_000n && micro < 10_000_000n, `10 EURTD gives ${micro} micro-EURC`);
  // The deposit has two decimals, so the fee on 1 EURTD is a whole cent: about 1%, as on-chain.
  assert.ok(quoteExactIn(LIVE, 100n, false) < 990_000n);
  assert.equal(minimumReceived(10_000n), 9_950n, "0.5% below the quote");
});

test("a conversion larger than the pool's range is refused, not quoted", () => {
  assert.throws(() => quoteExactIn(LIVE, 1_000_000_000n, true), /more than the pool can take/);
  assert.throws(() => quoteExactIn(LIVE, 0n, true), /more than zero/);
});
