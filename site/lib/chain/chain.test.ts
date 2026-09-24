import { test } from "node:test";
import assert from "node:assert/strict";
import { encodeFunctionData, parseAbiItem, stringToHex, type Address, type Hex } from "viem";
import { parseManifest, poolKey, ManifestError, type Manifest } from "./manifest.ts";
import { price } from "./price.ts";
import { Tape, reason } from "./tape.ts";
import { signerQueues } from "./queue.ts";

const A = (n: number) => `0x${n.toString(16).padStart(40, "0")}` as Address;

const manifest: Manifest = {
  chainId: 31337,
  parties: { issuer: A(1), agent: A(2), investorA: A(3), custodian: A(4) },
  assets: {
    venueAsset: { address: A(0x10), symbol: "ASSET", decimals: 18 },
    cash: { address: A(0x11), symbol: "CASH", decimals: 6 },
  },
  venue: {
    poolManager: A(0x20), permit2: A(0x21), adapterFactory: A(0x22), allowlistChecker: A(0x23),
    hook: A(0x24), router: A(0x25), positionManager: A(0x26), permissionsAdapter: A(0x27), weth: A(0x28),
  },
  pool: { currency0: A(0x11), currency1: A(0x27), fee: 3000, tickSpacing: 60, tickLower: -60, tickUpper: 60, hook: A(0x24) },
  custody: { custodian: A(4), factory: A(0x30), accounts: { "CLIENT-A": A(0x31) } },
};

const call = (signature: string, args: unknown[]) =>
  encodeFunctionData({ abi: [parseAbiItem(signature) as any], args });

const tx = (to: Address, input: Hex, from: Address = A(1)) => ({ hash: `0x${"ab".repeat(32)}` as Hex, block: 7, from, to, input });

// --- manifest ---

test("a manifest missing a venue address fails at load, naming the key", () => {
  const broken = structuredClone(manifest) as any;
  delete broken.venue.hook;
  assert.throws(() => parseManifest(JSON.stringify(broken)), (e: Error) => e instanceof ManifestError && /venue\.hook/.test(e.message));
});

test("a manifest with a malformed party address fails at load", () => {
  const broken = structuredClone(manifest) as any;
  broken.parties.agent = "0x1234";
  assert.throws(() => parseManifest(JSON.stringify(broken)), /parties\.agent/);
});

// --- price ---

const asset = { address: A(0x27), decimals: 18 };
const cash = { address: A(0x11), decimals: 6 };

test("price reads 100 cash per unit with the asset as currency0", () => {
  const key = { currency0: asset.address, currency1: cash.address, fee: 3000, tickSpacing: 60, hooks: A(0x24) };
  const p = Number(price(792281625142643375935439n, key, asset, cash));
  assert.ok(Math.abs(p - 100) < 1e-9, String(p));
});

test("price reads 100 cash per unit with cash as currency0", () => {
  const key = poolKey(manifest.pool);
  assert.equal(price(7922816251426433759354395033600000n, key, asset, cash), "100");
});

test("price refuses a token that is not in the pool", () => {
  assert.throws(() => price(1n << 96n, poolKey(manifest.pool), { address: A(0x99), decimals: 18 }, cash));
});

// --- tape ---

const tape = new Tape(manifest);

test("the same function on two tokens is two different rows", () => {
  const [onAsset] = tape.describe(tx(A(0x10), call("function mint(address,uint256)", [A(3), 5n * 10n ** 18n])));
  const [onCash] = tape.describe(tx(A(0x11), call("function mint(address,uint256)", [A(3), 5n * 10n ** 6n])));
  assert.equal(onAsset.meaning, "Issued units");
  assert.equal(onCash.meaning, "Issued test cash");
  assert.deepEqual(onAsset.args, ["Investor A", "5 ASSET"]);
  assert.deepEqual(onCash.args, ["Investor A", "5 CASH"]);
});

test("an amount is formatted in its own token's decimals, however small", () => {
  const [row] = tape.describe(tx(A(0x11), call("function transfer(address,uint256)", [A(3), 1n])));
  assert.equal(row.args[1], "0.000001 CASH");
});

test("a maximum allowance reads as unlimited, not as a quantity", () => {
  const [row] = tape.describe(tx(A(0x11), call("function approve(address,uint256)", [A(0x21), (1n << 256n) - 1n])));
  assert.equal(row.args[1], "unlimited CASH");
});

test("an unknown selector on a known contract is kept, marked unrecognised, with its calldata", () => {
  const input = call("function burn(address,uint256)", [A(3), 1n]);
  const rows = tape.describe(tx(A(0x10), input));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].recognised, false);
  assert.equal(rows[0].tone, "unrecognised");
  assert.equal(rows[0].fn, input.slice(0, 10));
  assert.deepEqual(rows[0].args, [input]);
  assert.match(rows[0].meaning, /restrictedAsset/);
});

test("a call to a contract the manifest does not name is kept, marked unrecognised", () => {
  const rows = tape.describe(tx(A(0x77), call("function pause()", [])));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].recognised, false);
});

test("a custody call is unwrapped to the instruction it carried", () => {
  const inner = call("function transfer(address,uint256)", [A(3), 2n * 10n ** 18n]);
  const [row] = tape.describe(tx(A(0x31), call("function executeOne(address,uint256,bytes)", [A(0x10), 0n, inner]), A(4)));
  assert.equal(row.via, "CLIENT-A");
  assert.equal(row.from, "Custodian");
  assert.equal(row.target, "ASSET");
  assert.deepEqual(row.args, ["Investor A", "2 ASSET"]);
});

test("a custody batch becomes one row per call, and an unknown inner call is kept", () => {
  const known = call("function approve(address,uint256)", [A(0x21), 1n]);
  const unknown = call("function burn(uint256)", [1n]);
  const batch = call("function execute((address target, uint256 value, bytes data)[])", [[
    { target: A(0x11), value: 0n, data: known },
    { target: A(0x11), value: 0n, data: unknown },
  ]]);
  const rows = tape.describe(tx(A(0x31), batch, A(4)));
  assert.equal(rows.length, 2);
  assert.equal(rows[0].meaning, "Set an allowance on cash");
  assert.equal(rows[1].recognised, false);
  assert.ok(rows.every((r) => r.via === "CLIENT-A"));
});

test("text is shown whole", () => {
  const ref = "CLIENT-".padEnd(200, "X");
  const [row] = tape.describe(tx(A(0x30), call("function createAccount(string)", [ref]), A(4)));
  assert.equal(row.args[0], JSON.stringify(ref));
});

test("a reason payload is shown as its full text, or in full hex when it is not text", () => {
  const written = "Court order 2026/114: return of units transferred in error on the 23rd, record date the 25th.";
  assert.equal(reason(stringToHex(written)), JSON.stringify(written));
  assert.equal(reason("0xff00ff"), "0xff00ff");
});

test("a deployment is shown, not skipped", () => {
  const row = tape.describeCreation({ hash: `0x${"cd".repeat(32)}`, block: 1, from: A(1) }, A(0x10));
  assert.equal(row.meaning, "Deployed a contract");
  assert.equal(row.target, "ASSET");
});

// --- queue ---

test("one signer's tasks run in order; another signer's do not wait for them", async () => {
  const enqueue = signerQueues<string>();
  const order: string[] = [];
  const slow = enqueue("issuer", () => new Promise<void>((r) => setTimeout(() => { order.push("issuer 1"); r(); }, 30)));
  const second = enqueue("issuer", async () => { order.push("issuer 2"); });
  const other = enqueue("agent", async () => { order.push("agent"); });
  await Promise.all([slow, second, other]);
  assert.deepEqual(order, ["agent", "issuer 1", "issuer 2"]);
});

test("a failed task does not stop the queue", async () => {
  const enqueue = signerQueues<string>();
  await assert.rejects(enqueue("issuer", async () => { throw new Error("reverted"); }));
  assert.equal(await enqueue("issuer", async () => "next"), "next");
});
