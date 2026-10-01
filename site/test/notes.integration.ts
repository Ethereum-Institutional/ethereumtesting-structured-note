/**
 * Notes issued from the site, against the local chain (ADRs 0072, 0073): issued from the site, step by step,
 * through the lagging RPC, and checked on-chain.
 *
 *   ../ops/reset.sh && npm run test:admission
 */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPublicClient, http, parseAbi, type Address } from "viem";
import { startLaggingRpc } from "./lagging-rpc.ts";

const REPO = join(import.meta.dirname, "..", "..");
const RPC = process.env.RPC_URL ?? "http://127.0.0.1:8545";
const lagging = await startLaggingRpc(4031, RPC);
after(() => lagging.close());

process.chdir(mkdtempSync(join(tmpdir(), "notes-"))); // a fresh development store
Object.assign(process.env, { NODE_ENV: "development", MANIFEST_PATH: join(REPO, "ops", "addresses.json"), RPC_URL: lagging.url, OPERATOR_EMAILS: "operator@example.org" });
const notes = await import("../lib/notes/issue.ts");
const { getStore } = await import("../lib/store.ts");
const { loadManifest } = await import("../lib/chain/manifest.ts");
const store = getStore();
const operator = { id: "reg_operator", email: "operator@example.org", name: "Operator", organisation: "The Bank", status: "approved" as const, createdAt: new Date().toISOString(), verifiedAt: null, decidedAt: null, decidedBy: null };
const client = createPublicClient({ transport: http(RPC) });

/** Advances issuance as the page does: one step per call, a failed step tried again a moment later. */
async function issued(id: string) {
  for (let i = 0; i < notes.ISSUANCE_STEPS.length * 4; i++) {
    const n = await notes.advanceIssuance(id);
    if (n?.status !== "issuing") return n!;
    if (n.error) await new Promise((r) => setTimeout(r, 1000));
  }
  return (await store.noteById(id))!;
}

test("a note is issued from the site, step by step, on the live note's implementation", async () => {
  await assert.rejects(notes.startNote({ ...operator, email: "someone@corp.example" } as any, { scenario: "mer-at-trigger", observations: 4, interval: { value: 5, unit: "minutes" as const }, units: 20 }), /Not permitted/);
  await assert.rejects(notes.startNote(operator as any, { scenario: "nope", observations: 4, interval: { value: 5, unit: "minutes" as const }, units: 20 }), /Choose a scenario/);
  const started = await notes.startNote(operator as any, { scenario: "mer-at-trigger", observations: 4, interval: { value: 5, unit: "minutes" as const }, units: 20 });
  assert.equal(started.symbol, "EURWAN2");
  assert.equal(started.name, "EUR Worst-of Autocallable Note, Series 2");

  const n = await issued(started.id);
  assert.equal(n.status, "issued", n.error);
  assert.equal(Object.keys(n.txs).length, notes.ISSUANCE_STEPS.length, "one transaction per step, each recorded");

  const m = loadManifest();
  const note = n.addresses.note as Address;
  const NOTE = parseAbi([
    "function name() view returns (string)",
    "function symbol() view returns (string)",
    "function totalSupply() view returns (uint256)",
    "function balanceOf(address) view returns (uint256)",
    "function hasRole(bytes32 role, address account) view returns (bool)",
    "function BURNER_ROLE() view returns (bytes32)",
    "function SNAPSHOOTER_ROLE() view returns (bytes32)",
  ]);
  assert.equal(await client.readContract({ address: note, abi: NOTE, functionName: "symbol" }), "EURWAN2");
  assert.equal(await client.readContract({ address: note, abi: NOTE, functionName: "totalSupply" }), 20n);
  assert.equal(await client.readContract({ address: note, abi: NOTE, functionName: "balanceOf", args: [m.parties.issuer as Address] }), 20n, "the Issuer's inventory");

  // The same implementation as the note under review.
  const slot = "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";
  const impl = async (a: Address) => `0x${(await client.getStorageAt({ address: a, slot }))!.slice(-40)}`.toLowerCase();
  assert.equal(await impl(note), await impl(m.assets.note!.address as Address));

  // The calendar is the one chosen: four observations five minutes apart, from the terms' block.
  const DET = parseAbi(["function observation(uint256) view returns ((uint48 date, uint48 recordTime, uint48 paymentDate, bool coupon, bool mer, bool barrier, bool isFinal, uint32 merTriggerBps))"]);
  const first = await client.readContract({ address: n.addresses.determinations as Address, abi: DET, functionName: "observation", args: [0n] });
  const second = await client.readContract({ address: n.addresses.determinations as Address, abi: DET, functionName: "observation", args: [1n] });
  assert.equal(Number(second.date) - Number(first.date), 300);
  assert.equal(Number(first.recordTime) - Number(first.date), 60);
  assert.deepEqual(n.calendar?.map((c) => c.date), [0, 1, 2, 3].map((k) => Number(first.date) + k * 300));

  // Roles as the issuance script leaves them: the Paying Agent burns; no one keeps the snapshot role.
  const burner = await client.readContract({ address: note, abi: NOTE, functionName: "BURNER_ROLE" });
  assert.equal(await client.readContract({ address: note, abi: NOTE, functionName: "hasRole", args: [burner, n.addresses.payingAgent as Address] }), true);
  const snap = await client.readContract({ address: note, abi: NOTE, functionName: "SNAPSHOOTER_ROLE" });
  assert.equal(await client.readContract({ address: note, abi: NOTE, functionName: "hasRole", args: [snap, m.parties.issuer as Address] }), false);
  assert.ok(lagging.staleReads() > 0, "issued through a lagging RPC");
});

test("a note with six observations, an hour apart, is issued with that schedule", async () => {
  const started = await notes.startNote(operator as any, { scenario: "coupon-at-barrier", observations: 6, interval: { value: 1, unit: "hours" }, units: 5 });
  const n = await issued(started.id);
  assert.equal(n.status, "issued", n.error);
  const DET = parseAbi([
    "function observationCount() view returns (uint256)",
    "function observation(uint256) view returns ((uint48 date, uint48 recordTime, uint48 paymentDate, bool coupon, bool mer, bool barrier, bool isFinal, uint32 merTriggerBps))",
  ]);
  const at = n.addresses.determinations as Address;
  assert.equal(await client.readContract({ address: at, abi: DET, functionName: "observationCount" }), 6n);
  const last = await client.readContract({ address: at, abi: DET, functionName: "observation", args: [5n] });
  const fifth = await client.readContract({ address: at, abi: DET, functionName: "observation", args: [4n] });
  assert.equal(last.isFinal, true);
  assert.equal(fifth.isFinal, false);
  assert.equal(Number(last.date) - Number(fifth.date), 3600);
  assert.equal(Number(last.recordTime) - Number(last.date), 720, "a fifth of an hour");
});

// --- selling restrictions and placement (ADR 0075; S-08, S-09) ---

const place = await import("../lib/notes/place.ts");
const { privateKeyToAccount } = await import("viem/accounts");
const { createWalletClient, keccak256, toBytes } = await import("viem");
const LOCAL = JSON.parse((await import("node:fs")).readFileSync(join(REPO, "ops", "addresses.json"), "utf8"));
const GATEWAY = parseAbi(["function credit(address account, uint256 amount, bytes32 bookingRef)"]);
const BAL = parseAbi(["function balanceOf(address) view returns (uint256)"]);

/** An admitted account as the site records it, for an account the local deployment onboarded without Reg S. */
async function admitted(id: string, route: "custodied" | "self-custody", wallet: Address, registrantId: string) {
  await store.putAdmission({
    id, registrantId, route, status: "admitted", createdAt: new Date().toISOString(), officerRequestId: null, walletRequestId: null,
    data: { assessment: { ok: true, summary: { wallet, corporation: "Test Institution One" } } },
  });
  return id;
}
async function credit(account: Address, cents: bigint) {
  const agent = createWalletClient({ account: privateKeyToAccount("0x2a871d0798f97d79848a013d4936a73bf4cc922c825d33c1cf7073dff6d409c6"), transport: http(RPC) });
  const h = await agent.writeContract({ address: LOCAL.instruments.gateway, abi: GATEWAY, functionName: "credit", args: [account, cents, keccak256(toBytes(`test credit ${account} ${Date.now()}`))], chain: null });
  await client.waitForTransactionReceipt({ hash: h });
}
const client3p = { ...operator, id: "reg_client_c", email: "treasury@corp.example" };

test("S-09, then S-08: an unapproved wallet is refused; once approved, it accepts the Issuer's offer in two transactions", async () => {
  const n = (await store.listNotes()).find((x) => x.observations === 6 && x.status === "issued")!;
  const investorC = LOCAL.parties.investorC as Address;
  const id = await admitted("adm_test_c", "self-custody", investorC, client3p.id);
  await credit(investorC, 1_000_000n); // €10,000.00
  const before = await client.readContract({ address: LOCAL.assets.deposit.address, abi: BAL, functionName: "balanceOf", args: [investorC] });

  await assert.rejects(place.placeUnits(operator as any, n.id, id, 2, 100_000n), /lacks the Reg S flag \(S-09\)/);
  assert.equal(await place.hasRegS(investorC), false);
  await place.approveForNote(operator as any, id);
  assert.equal(await place.hasRegS(investorC), true);
  await assert.rejects(place.approveForNote(operator as any, id), /already approved/);

  const offered = await place.placeUnits(operator as any, n.id, id, 2, 100_000n);
  assert.equal(offered.status, "offered", "a client's own wallet accepts itself");
  assert.equal(offered.priceCents, "200000");
  await assert.rejects(place.acceptanceFor(operator as any, n.id, offered.id, investorC), /not yours/);

  const txs = await place.acceptanceFor(client3p as any, n.id, offered.id, investorC);
  assert.equal(txs.length, 2, "the price's allowance, then the acceptance");
  const wallet = createWalletClient({ account: privateKeyToAccount("0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba"), transport: http(RPC) });
  let last: `0x${string}` = "0x";
  for (const t of txs) {
    last = await wallet.sendTransaction({ to: t.to, data: t.data, chain: null });
    await client.waitForTransactionReceipt({ hash: last });
  }
  const after = await place.refreshPlacement(n.id, offered.id, last);
  assert.equal(after?.status, "settled");
  assert.equal(await client.readContract({ address: n.addresses.note as Address, abi: BAL, functionName: "balanceOf", args: [investorC] }), 2n);
  assert.equal(await client.readContract({ address: LOCAL.assets.deposit.address, abi: BAL, functionName: "balanceOf", args: [investorC] }), before - 200_000n, "paid €2,000 for two units");
});

test("S-08 for a custody account: the custodian accepts in the same action, and both legs settle", async () => {
  const n = (await store.listNotes()).find((x) => x.observations === 6 && x.status === "issued")!;
  const account = LOCAL.custody.accounts["SEG-0003"] as Address;
  const id = await admitted("adm_test_seg3", "custodied", account, operator.id);
  await credit(account, 200_000n);
  await place.approveForNote(operator as any, id);
  const p = await place.placeUnits(operator as any, n.id, id, 1, 100_000n);
  assert.equal(p.status, "settled");
  assert.ok(p.txs.accepted);
  assert.equal(await client.readContract({ address: n.addresses.note as Address, abi: BAL, functionName: "balanceOf", args: [account] }), 1n);
  const recorded = ((await store.noteById(n.id))!.data.placements as any[]).map((x) => `${x.id}:${x.status}`);
  assert.deepEqual(recorded.sort(), ["1:settled", "2:settled"]);
});
