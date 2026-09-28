import { test } from "node:test";
import assert from "node:assert/strict";
import { encodeFunctionData, parseAbiItem, stringToHex, type Address, type Hex } from "viem";
import { parseManifest, poolKey, ManifestError, type Manifest } from "./manifest.ts";
import { price } from "./price.ts";
import { Tape, reason, grantFlags, ref } from "./tape.ts";
import { signerQueues } from "./queue.ts";

const A = (n: number) => `0x${n.toString(16).padStart(40, "0")}` as Address;

const manifest: Manifest = {
  chainId: 31337,
  parties: { issuer: A(1), agent: A(2), investorA: A(3), custodian: A(4) },
  assets: {
    paymentToken: { address: A(0x11), symbol: "EURPT", decimals: 6 },
    note: { address: A(0x40), symbol: "EURWAN", decimals: 0 },
    deposit: { address: A(0x41), symbol: "EURTD", decimals: 2 },
  },
  venue: {
    poolManager: A(0x20), permit2: A(0x21), adapterFactory: A(0x22), allowlistChecker: A(0x23), credentialGate: A(0x29),
    hook: A(0x24), router: A(0x25), positionManager: A(0x26), permissionsAdapter: A(0x27), weth: A(0x28),
  },
  pool: { currency0: A(0x11), currency1: A(0x27), fee: 3000, tickSpacing: 60, tickLower: -60, tickUpper: 60, hook: A(0x24) },
  custody: { custodian: A(4), factory: A(0x30), accounts: { "SEG-0001": A(0x31) } },
  instruments: { registry: A(0x42), noteGate: A(0x43), depositGate: A(0x44), note: A(0x40), deposit: A(0x41), gateway: A(0x45) },
  lifecycle: { determinations: A(0x50), recordDates: A(0x51), payingAgent: A(0x52), settlement: A(0x53) },
  governance: { controller: A(0x60), walletFactory: A(0x61), agentGovernance: A(0x62), issuerGovernance: A(0x63), cosigner: A(0x64), servicingWallet: A(0x65), tier2Delay: 3600, recoveryDelay: 14400 },
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
  const [onDeposit] = tape.describe(tx(A(0x41), call("function mint(address,uint256)", [A(3), 5n * 10n ** 2n])));
  const [onPayment] = tape.describe(tx(A(0x11), call("function mint(address,uint256)", [A(3), 5n * 10n ** 6n])));
  assert.equal(onDeposit.meaning, "Issued units");
  assert.equal(onPayment.meaning, "Issued the payment token (local stand-in only)");
  assert.deepEqual(onDeposit.args, ["Investor A", "5 EURTD"]);
  assert.deepEqual(onPayment.args, ["Investor A", "5 EURPT"]);
});

test("an amount is formatted in its own token's decimals, however small", () => {
  const [row] = tape.describe(tx(A(0x11), call("function transfer(address,uint256)", [A(3), 1n])));
  assert.equal(row.args[1], "0.000001 EURPT");
});

test("a maximum allowance reads as unlimited, not as a quantity", () => {
  const [row] = tape.describe(tx(A(0x11), call("function approve(address,uint256)", [A(0x21), (1n << 256n) - 1n])));
  assert.equal(row.args[1], "unlimited EURPT");
});

test("an unknown selector on a known contract is kept, marked unrecognised, with its calldata", () => {
  const input = call("function sweep(address,uint256)", [A(3), 1n]);
  const rows = tape.describe(tx(A(0x41), input));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].recognised, false);
  assert.equal(rows[0].tone, "unrecognised");
  assert.equal(rows[0].fn, input.slice(0, 10));
  assert.deepEqual(rows[0].args, [input]);
  assert.match(rows[0].meaning, /deposit/);
});

test("a call to a contract the manifest does not name is kept, marked unrecognised", () => {
  const rows = tape.describe(tx(A(0x77), call("function pause()", [])));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].recognised, false);
});

test("a custody call is unwrapped to the instruction it carried", () => {
  const inner = call("function transfer(address,uint256)", [A(3), 2n * 10n ** 2n]);
  const [row] = tape.describe(tx(A(0x31), call("function executeOne(address,uint256,bytes)", [A(0x41), 0n, inner]), A(4)));
  assert.equal(row.via, "SEG-0001");
  assert.equal(row.from, "Custodian");
  assert.equal(row.target, "EURTD");
  assert.deepEqual(row.args, ["Investor A", "2 EURTD"]);
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
  assert.equal(rows[0].meaning, "Set an allowance on the payment token");
  assert.equal(rows[1].recognised, false);
  assert.ok(rows.every((r) => r.via === "SEG-0001"));
});

test("text is shown whole", () => {
  const ref = "SEG-".padEnd(200, "X");
  const [row] = tape.describe(tx(A(0x30), call("function createAccount(string)", [ref]), A(4)));
  assert.equal(row.args[0], JSON.stringify(ref));
});

test("a reason payload is shown as its full text, or in full hex when it is not text", () => {
  const written = "Court order 2026/114: return of units transferred in error on the 23rd, record date the 25th.";
  assert.equal(reason(stringToHex(written)), JSON.stringify(written));
  assert.equal(reason("0xff00ff"), "0xff00ff");
});

test("a deployment is shown, not skipped", () => {
  const row = tape.describeCreation({ hash: `0x${"cd".repeat(32)}`, block: 1, from: A(1) }, A(0x41));
  assert.equal(row.meaning, "Deployed a contract");
  assert.equal(row.target, "EURTD");
});

test("a note balance is a count of units; a deposit amount has two decimals", () => {
  const [note] = tape.describe(tx(A(0x40), call("function mint(address,uint256)", [A(3), 7n])));
  const [credit] = tape.describe(tx(A(0x45), call("function credit(address,uint256,bytes32)", [A(3), 123456n, stringToHex("booking-1", { size: 32 })])));
  assert.deepEqual(note.args, ["Investor A", "7 EURWAN"]);
  assert.deepEqual(credit.args, ["Investor A", "1234.56 EURTD", '"booking-1"']);
});

test("a grant shows its flags by name and its expiry as a date", () => {
  const input = call("function grant(address,uint32,uint16,uint40,bytes32,bytes32)", [A(3), (1 << 0) | (1 << 1) | (1 << 8) | (1 << 20), 276, 1_790_000_000n, `0x${"ab".repeat(32)}`, `0x${"00".repeat(32)}`]);
  const [row] = tape.describe(tx(A(0x42), input, A(2)));
  assert.equal(row.meaning, "Granted eligibility after a verified presentation");
  assert.equal(row.args[1], "HOLD|RECEIVE|REG_S|0x100000", "an unknown bit is shown, not dropped");
  assert.equal(row.args[3], "2026-09-21T14:13:20.000Z");
  assert.equal(row.args[4], `0x${"ab".repeat(32)}`, "a reference that is not text stays hex");
});

test("a role is named when it is a known role", () => {
  const [row] = tape.describe(tx(A(0x40), call("function grantRole(bytes32,address)", [`0x${"00".repeat(32)}`, A(2)])));
  assert.deepEqual(row.args, ["DEFAULT_ADMIN_ROLE", "Agent"]);
});

test("party keys read as capacities", async () => {
  const { partyLabel } = await import("./manifest.ts");
  assert.equal(partyLabel("investorA"), "Investor A");
  assert.equal(partyLabel("accessIssuer"), "Access Issuer");
  assert.equal(partyLabel("agent"), "Agent");
});

test("a supervisory withdrawal shows its reason whole", () => {
  const why = "Sanctions designation notified 24 September 2026; grant written by the second registrar";
  const [row] = tape.describe(tx(A(0x42), call("function withdraw(address,string)", [A(3), why])));
  assert.equal(row.tone, "control");
  assert.deepEqual(row.args, ["Investor A", JSON.stringify(why)]);
});

test("a determination reads as its outcome, in euros per Calculation Amount", () => {
  const input = call(
    "function determine(uint256,uint256[],(bool,bool,uint64,bool,uint64,uint8),bytes)",
    [2n, [406_080n, 1_729_285n, 23_750n], [false, true, 2_500n, false, 0n, 0], "0x" + "11".repeat(65)],
  );
  const [row] = tape.describe(tx(A(0x50), input, A(9)));
  assert.equal(row.args[2], "coupon EUR 25.00 per CA; no redemption; no breach; worst performer 0");
  assert.equal(row.args[3], "«signature, 65 bytes»");
});

test("a DvP proposal shows units of the note and a price in the deposit", () => {
  const [row] = tape.describe(tx(A(0x53), call("function propose(address,address,uint64,uint256,uint48)", [A(1), A(3), 10n, 1_000_000n, 1_790_000_000n])));
  assert.deepEqual(row.args.slice(0, 4), ["Issuer", "Investor A", "10 EURWAN", "10000 EURTD"]);
});

test("a distribution's opening and payment name the kind and the holders", () => {
  const [open] = tape.describe(tx(A(0x52), call("function open(uint256,uint8)", [3n, 1])));
  const [pay] = tape.describe(tx(A(0x52), call("function pay(bytes32,address[])", [`0x${"cd".repeat(32)}`, [A(3), A(0x31)]])));
  assert.deepEqual(open.args, ["3", "redemption"]);
  assert.equal(pay.args[1], "[Investor A, SEG-0001]");
});

test("a wallet transaction is shown as the governance act it carried", () => {
  const inner = call("function correctRegister(address,address,uint256,string)", [A(3), A(4), 2n, "Register correction"]);
  const input = call(
    "function execTransaction(address,uint256,bytes,uint8,uint256,uint256,uint256,address,address,bytes)",
    [A(0x60), 0n, inner, 0, 0n, 0n, 0n, A(0), A(0), "0x" + "22".repeat(130)],
  );
  const [row] = tape.describe(tx(A(0x62), input, A(0x70)));
  assert.equal(row.via, "Agent governance wallet");
  assert.equal(row.target, "Governance controller");
  assert.equal(row.meaning, "Tier 1: corrected the register to match the Register");
  assert.deepEqual(row.args, ["Investor A", "Custodian", "2 EURWAN", '"Register correction"']);
});

test("flag and reference renderings", () => {
  assert.equal(grantFlags(0), "none");
  assert.equal(ref(stringToHex("opening/investorA", { size: 32 })), '"opening/investorA"');
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

test("a pool admission reads as the policy it was checked against", () => {
  const input = call(
    "function grant((address account, uint8 path, bytes32 primaryCredential, bytes32 screeningCredential, bytes32 walletCredential, bytes32 authorityCredential, bytes32 primarySchema, bytes32 screeningSchema, uint32 checks, bytes2 jurisdiction, uint8 investorClass, uint40 screenedAt, uint40 credentialExpiry, bytes32 evidence))",
    [{
      account: A(3), path: 1, primaryCredential: `0x${"11".repeat(32)}`, screeningCredential: `0x${"22".repeat(32)}`, walletCredential: `0x${"66".repeat(32)}`, authorityCredential: `0x${"77".repeat(32)}`,
      primarySchema: `0x${"33".repeat(32)}`, screeningSchema: `0x${"44".repeat(32)}`, checks: 7, jurisdiction: "0x4c55",
      investorClass: 2, screenedAt: 1_790_000_000, credentialExpiry: 1_820_000_000, evidence: `0x${"55".repeat(32)}`,
    }],
  );
  const [row] = tape.describe(tx(A(0x29), input, A(2)));
  assert.equal(row.target, "Pool credential gate");
  assert.equal(row.meaning, "Admitted an account to the pool from a presentation verified off-chain");
  assert.match(row.args[0], /^Investor A, entity; jurisdiction LU; institutional; checks wallet control, not expired, entity active;/);
});

test("the pool's supervisory withdrawal shows its reason whole", () => {
  const why = "Adverse media match under review; pool access suspended pending the outcome of the review.";
  const [row] = tape.describe(tx(A(0x60), call("function withdrawPoolAccess(address,string)", [A(3), why])));
  assert.equal(row.meaning, "Tier 1: withdrew an account's pool access under supervisory authority");
  assert.equal(row.args[1], JSON.stringify(why));
});
