import { test } from "node:test";
import assert from "node:assert/strict";
import { createPublicClient, http, parseAbi } from "viem";
import { foundry } from "viem/chains";
import { loadManifest, poolId, poolKey } from "./manifest.ts";
import { priceOfAsset } from "./price.ts";
import { Tape, readTape } from "./tape.ts";

/**
 * Against the local deployment. Needs a running chain and MANIFEST_PATH:
 *
 *   ../ops/reset.sh && MANIFEST_PATH=../ops/addresses.json npm run test:chain
 */

const m = loadManifest();
const client = createPublicClient({ chain: { ...foundry, id: m.chainId }, transport: http(process.env.RPC_URL ?? "http://127.0.0.1:8545") });

test("the pool id locates the deployed pool, and its price reads 100 cash per unit", async () => {
  const [sqrtPriceX96] = await client.readContract({
    address: m.lens!.stateView,
    abi: parseAbi(["function getSlot0(bytes32) view returns (uint160, int24, uint24, uint24)"]),
    functionName: "getSlot0",
    args: [poolId(poolKey(m.pool))],
  });
  assert.ok(sqrtPriceX96 > 0n, "no pool at this id");
  const p = Number(priceOfAsset(sqrtPriceX96, poolKey(m.pool), m.venue.permissionsAdapter, m.assets.venueAsset, m.assets.cash));
  assert.ok(Math.abs(p - 100) < 1e-6, String(p));
});

test("every call the deploy scripts made is recognised by the tape", async () => {
  const rows = await readTape(client as any, new Tape(m), 500);
  assert.ok(rows.length > 20, `only ${rows.length} rows`);
  const unknown = rows.filter((r) => !r.recognised);
  assert.deepEqual(unknown.map((r) => `${r.target}.${r.fn}`), []);
});
