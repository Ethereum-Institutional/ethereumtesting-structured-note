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

// --- determinations, payments and closure (ADR 0078) ---

const life = await import("../lib/notes/lifecycle.ts");
const REGISTRY = parseAbi([
  "function grantOf(address account) view returns ((uint32 flags, uint16 jurisdiction, uint16 registrar, uint40 grantedAt, uint40 expiresAt))",
  "function credentialRefOf(address) view returns (bytes32)",
  "function commitmentOf(address) view returns (bytes32)",
  "function grant(address account, uint32 flags, uint16 jurisdiction, uint40 expiresAt, bytes32 credentialRef, bytes32 commitment)",
  "function revoke(address account)",
]);
const SUPPLY = parseAbi(["function totalSupply() view returns (uint256)", "function paused() view returns (bool)"]);
const accessIssuer = createWalletClient({ account: privateKeyToAccount("0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a"), transport: http(RPC) });

/** Moves the local chain's clock to just past `t`, and mines a block there. */
async function warpTo(t: number) {
  const latest = Number((await client.getBlock()).timestamp);
  if (latest <= t) await client.request({ method: "evm_increaseTime" as any, params: [t - latest + 1] as any });
  await client.request({ method: "evm_mine" as any, params: [] as any });
  await new Promise((r) => setTimeout(r, 1600)); // past the lagging RPC's window
}
const deposit = (a: Address) => client.readContract({ address: LOCAL.assets.deposit.address, abi: BAL, functionName: "balanceOf", args: [a] });

/** Issues a four-date note two minutes apart and places units with the custody account and investor C. */
async function placedNote(scenario: string, custodyUnits: number, walletUnits: number) {
  const started = await notes.startNote(operator as any, { scenario, observations: 4, interval: { value: 2, unit: "minutes" as const }, units: 10 });
  const n = await issued(started.id);
  assert.equal(n.status, "issued", n.error);
  await credit(LOCAL.custody.accounts["SEG-0003"], 100_000n * BigInt(custodyUnits));
  if (custodyUnits) assert.equal((await place.placeUnits(operator as any, n.id, "adm_test_seg3", custodyUnits, 100_000n)).status, "settled");
  if (walletUnits) {
    const offered = await place.placeUnits(operator as any, n.id, "adm_test_c", walletUnits, 100_000n);
    const wallet = createWalletClient({ account: privateKeyToAccount("0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba"), transport: http(RPC) });
    for (const t of await place.acceptanceFor(client3p as any, n.id, offered.id, LOCAL.parties.investorC)) {
      await client.waitForTransactionReceipt({ hash: await wallet.sendTransaction({ to: t.to, data: t.data, chain: null }) });
    }
    assert.equal((await place.refreshPlacement(n.id, offered.id, "0x"))?.status, "settled");
  }
  return (await store.noteById(n.id))!;
}

test("a four-date note through its life: each date determined from the scenario's Levels, paid to the holders of record, checked against the model, and closed", async () => {
  const n = await placedNote("final-one-unit-below-barrier", 2, 1);
  const custody = LOCAL.custody.accounts["SEG-0003"] as Address;
  const investorC = LOCAL.parties.investorC as Address;
  let view = await life.lifecycleOf(n);
  assert.equal(view.dates.length, 4);
  assert.equal(view.dates[0].can.determine, false, "not before its date");
  assert.match(view.dates[0].waiting ?? "", /Determinable from/);
  await assert.rejects(life.determineDate(operator as any, n.id, 0, view.dates[0].suggested.map(BigInt)), /determinable from/);
  await assert.rejects(life.determineDate(operator as any, n.id, 1, view.dates[1].suggested.map(BigInt)), /Date 1 is the next/);

  for (let k = 0; k < 4; k++) {
    view = await life.lifecycleOf((await store.noteById(n.id))!);
    await warpTo(view.dates[k].date);
    if (k === 0) await assert.rejects(life.determineDate(operator as any, n.id, 0, [1n]), /Levels are refused/);
    await life.determineDate(operator as any, n.id, k, view.dates[k].suggested.map(BigInt));
    view = await life.lifecycleOf((await store.noteById(n.id))!);
    const d = view.dates[k];
    assert.equal(d.determined, true);
    assert.equal(d.model?.matches, true, `date ${k + 1} agrees with the independent model`);
    const kinds = d.events.map((e) => e.kind);
    assert.deepEqual(kinds, k < 3 ? ["coupon"] : ["redemption"]);
    await assert.rejects(life.payEvent(operator as any, n.id, k, kinds[0]), /payable from/);
    await warpTo(d.paymentDate);

    if (k === 1) {
      // A holder the deposit cannot credit (its grant revoked) is held for, not skipped (E3).
      const [g, ref, commitment] = await Promise.all([
        client.readContract({ address: LOCAL.instruments.registry, abi: REGISTRY, functionName: "grantOf", args: [investorC] }),
        client.readContract({ address: LOCAL.instruments.registry, abi: REGISTRY, functionName: "credentialRefOf", args: [investorC] }),
        client.readContract({ address: LOCAL.instruments.registry, abi: REGISTRY, functionName: "commitmentOf", args: [investorC] }),
      ]);
      await client.waitForTransactionReceipt({ hash: await accessIssuer.writeContract({ address: LOCAL.instruments.registry, abi: REGISTRY, functionName: "revoke", args: [investorC], chain: null }) });
      await life.payEvent(operator as any, n.id, k, "coupon");
      view = await life.lifecycleOf((await store.noteById(n.id))!);
      const held = view.dates[k].events[0].payments.find((p) => p.holder.toLowerCase() === investorC.toLowerCase())!;
      assert.equal(held.held, true);
      assert.equal(view.dates[k].events[0].closed, true, "the event still closes for everyone else");
      await assert.rejects(life.claimHeld(operator as any, n.id, view.dates[k].events[0].id, investorC), /cannot yet receive/);
      await client.waitForTransactionReceipt({ hash: await accessIssuer.writeContract({ address: LOCAL.instruments.registry, abi: REGISTRY, functionName: "grant", args: [investorC, g.flags, g.jurisdiction, g.expiresAt, ref, commitment], chain: null }) });
      await new Promise((r) => setTimeout(r, 1600));
      const before = await deposit(investorC);
      await life.claimHeld(operator as any, n.id, view.dates[k].events[0].id, investorC);
      assert.equal(await deposit(investorC), before + 2_500n, "claimed once its grant is live again");
      continue;
    }

    const [c0, w0] = await Promise.all([deposit(custody), deposit(investorC)]);
    await life.payEvent(operator as any, n.id, k, kinds[0]);
    const perUnit = k < 3 ? 2_500n : 60_000n; // €25 coupons; €600 at maturity, one unit below the barrier
    assert.equal(await deposit(custody), c0 + 2n * perUnit, `date ${k + 1}: the custody account's two units`);
    assert.equal(await deposit(investorC), w0 + perUnit, `date ${k + 1}: investor C's unit`);
    await assert.rejects(life.payEvent(operator as any, n.id, k, kinds[0]), /already paid/);
  }

  // Redeemed: the holders' units burned as they were paid, the inventory burned on closing.
  assert.equal(await client.readContract({ address: n.addresses.note as Address, abi: SUPPLY, functionName: "totalSupply" }), 0n);
  assert.equal(await client.readContract({ address: n.addresses.note as Address, abi: SUPPLY, functionName: "paused" }), true);
  assert.equal((await store.noteById(n.id))!.status, "closed");
  view = await life.lifecycleOf((await store.noteById(n.id))!);
  assert.equal(view.closed, true);
  const paid = await life.paymentsTo(custody);
  assert.deepEqual(paid.filter((p) => p.note.id === n.id).map((p) => `${p.kind}:${p.amount}`), ["coupon:5000", "coupon:5000", "coupon:5000", "redemption:120000"]);
});

test("an early redemption ends the note: the dates after it fall away", async () => {
  const n = await placedNote("mer-at-trigger", 1, 0);
  for (let k = 0; k < 2; k++) {
    let view = await life.lifecycleOf((await store.noteById(n.id))!);
    await warpTo(view.dates[k].date);
    await life.determineDate(operator as any, n.id, k, view.dates[k].suggested.map(BigInt));
    view = await life.lifecycleOf((await store.noteById(n.id))!);
    assert.equal(view.dates[k].model?.matches, true);
    await warpTo(view.dates[k].paymentDate);
    for (const e of view.dates[k].events) await life.payEvent(operator as any, n.id, k, e.kind);
  }
  const view = await life.lifecycleOf((await store.noteById(n.id))!);
  assert.deepEqual(view.dates[1].events.map((e) => e.kind), ["coupon", "redemption"]);
  assert.equal(view.terminated, true);
  assert.deepEqual(view.dates.slice(2).map((d) => d.fallsAway), [true, true]);
  assert.equal(view.dates[2].can.determine, false);
  await assert.rejects(life.determineDate(operator as any, n.id, 2, view.dates[2].suggested.map(BigInt)), /has redeemed/);
  assert.equal((await store.noteById(n.id))!.status, "closed");
});
