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
Object.assign(process.env, { NODE_ENV: "development", MANIFEST_PATH: join(REPO, "ops", "addresses.json"), RPC_URL: lagging.url, OPERATOR_EMAILS: "operator@example.org", BANK_EMAILS: "", ONBOARDING_EMAILS: "", AGENT_EMAILS: "", CUSTODIAN_EMAILS: "" });
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

test("a note is issued from the site in four steps, the Issuer's in one transaction through the note factory, as a T-REX suite on the deployment's fixed implementations", async () => {
  await assert.rejects(notes.startNote({ ...operator, email: "someone@corp.example" } as any, { scenario: "mer-at-trigger", observations: 4, interval: { value: 5, unit: "minutes" as const }, units: 20 }), /Not permitted/);
  await assert.rejects(notes.startNote(operator as any, { scenario: "nope", observations: 4, interval: { value: 5, unit: "minutes" as const }, units: 20 }), /Choose a scenario/);
  const started = await notes.startNote(operator as any, { scenario: "mer-at-trigger", observations: 4, interval: { value: 5, unit: "minutes" as const }, units: 20 });
  assert.equal(started.symbol, "EURWAN2");
  assert.equal(started.name, "EUR Worst-of Autocallable Note, Series 2");

  const n = await issued(started.id);
  assert.equal(n.status, "issued", n.error);
  assert.equal(notes.ISSUANCE_STEPS.length, 4, "the Issuer's one act, the bank's two, the Agent's one");
  assert.equal(new Set(Object.values(n.txs)).size, 4, "one transaction per step, each recorded");

  const m = loadManifest();
  const note = n.addresses.note as Address;
  const NOTE = parseAbi([
    "function name() view returns (string)",
    "function symbol() view returns (string)",
    "function totalSupply() view returns (uint256)",
    "function balanceOf(address) view returns (uint256)",
    "function isAgent(address) view returns (bool)",
    "function paused() view returns (bool)",
    "function getAgentRestrictions(address) view returns ((bool disableMint, bool disableBurn, bool disablePartialFreeze, bool disableAddressFreeze, bool disableRecovery, bool disableForceTransfer, bool disablePause))",
    "function getImplementationAuthority() view returns (address)",
  ]);
  assert.equal(await client.readContract({ address: note, abi: NOTE, functionName: "symbol" }), "EURWAN2");
  assert.equal(await client.readContract({ address: note, abi: NOTE, functionName: "totalSupply" }), 20n);
  assert.equal(await client.readContract({ address: note, abi: NOTE, functionName: "balanceOf", args: [m.parties.issuer as Address] }), 20n, "the Issuer's inventory");

  // The same fixed implementations as the note under review (ADR 0088), and open for transfers.
  const authority = (a: Address) => client.readContract({ address: a, abi: NOTE, functionName: "getImplementationAuthority" });
  assert.equal(await authority(note), await authority(m.assets.note!.address as Address));
  assert.equal(await client.readContract({ address: note, abi: NOTE, functionName: "paused" }), false);

  // The calendar is the one chosen: four observations five minutes apart, from the terms' block.
  const DET = parseAbi(["function observation(uint256) view returns ((uint48 date, uint48 recordTime, uint48 paymentDate, bool coupon, bool mer, bool barrier, bool isFinal, uint32 merTriggerBps))"]);
  const first = await client.readContract({ address: n.addresses.determinations as Address, abi: DET, functionName: "observation", args: [0n] });
  const second = await client.readContract({ address: n.addresses.determinations as Address, abi: DET, functionName: "observation", args: [1n] });
  assert.equal(Number(second.date) - Number(first.date), 300);
  assert.equal(Number(first.recordTime) - Number(first.date), 60);
  assert.deepEqual(n.calendar?.map((c) => c.date), [0, 1, 2, 3].map((k) => Number(first.date) + k * 300));

  // Agents as the issuance script leaves them, each restricted to its own powers (ADR 0085).
  const restricted = (a: Address) => client.readContract({ address: note, abi: NOTE, functionName: "getAgentRestrictions", args: [a] });
  assert.equal(await client.readContract({ address: note, abi: NOTE, functionName: "isAgent", args: [n.addresses.payingAgent as Address] }), true);
  const pa = await restricted(n.addresses.payingAgent as Address);
  assert.deepEqual([pa.disableBurn, pa.disablePause, pa.disableMint, pa.disableForceTransfer], [false, false, true, true], "the Paying Agent burns and pauses, nothing else");
  const st = await restricted(n.addresses.settlement as Address);
  assert.deepEqual([st.disablePartialFreeze, st.disableBurn, st.disableMint], [false, true, true], "the settlement contract only locks units");
  const ag = await restricted(m.parties.agent as Address);
  assert.deepEqual([ag.disableBurn, ag.disableMint, ag.disablePause], [false, true, true], "the Agent only cancels inventory");

  // The factory owns the note for the Issuer, keeps no agent power, and records it (ADR 0091).
  const FACTORY = parseAbi(["function holds(address) view returns (bool)", "function noteOf(address) view returns ((address token, address identity, address identityRegistry, address compliance, address trustedIssuers, address claimTopics, address determinations, address recordDates, address payingAgent, address settlement))"]);
  const factory = m.identity!.noteFactory as Address;
  assert.equal(await client.readContract({ address: factory, abi: FACTORY, functionName: "holds", args: [note] }), true);
  assert.equal((await client.readContract({ address: factory, abi: FACTORY, functionName: "noteOf", args: [note] })).payingAgent, n.addresses.payingAgent);
  assert.equal(await client.readContract({ address: note, abi: NOTE, functionName: "isAgent", args: [factory] }), false);
  const OWNED = parseAbi(["function owner() view returns (address)"]);
  assert.equal(await client.readContract({ address: note, abi: OWNED, functionName: "owner" }), factory);
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

const onboarding = await import("../lib/identity/onboarding.ts");
const identities = await import("../lib/identity/onchain.ts");

/** An account the local deployment onboarded, as the site records it once it is onboarded here. */
async function admitted(id: string, route: "bank-custody" | "self-custody", wallet: Address, registrantId: string) {
  await store.putAdmission({
    id, registrantId, route, status: "onboarded", createdAt: new Date().toISOString(), officerRequestId: null, walletRequestId: null,
    data: { wallet, identity: await identities.identityOf(wallet), request: { organisation: "Test Institution One", requestedBy: "treasury@corp.example" } },
  });
  return id;
}

/**
 * The onboarding agent approves an account the deployment onboarded for cash only: its identity's
 * manager records the client's consent, the client asks, and the onboarding agent vouches (ADR 0089).
 */
async function approveForNote(id: string, manager: "depositAgent" | "custodian") {
  const a = (await store.admissionById(id))!;
  const identity = onboarding.dataOf(a).identity!;
  await identities.consent(identity, manager, LOCAL.parties.onboardingAgent);
  await store.updateAdmission({ ...a, data: { ...a.data, note: { status: "requested", requestedAt: new Date().toISOString(), answers: { notUsPerson: true, investorClass: "institutional", relyOnBankKyb: true } } } }, a.status);
  await onboarding.decideNote(operator as any, id, "approve");
  await new Promise((r) => setTimeout(r, 1600)); // past the lagging RPC's window
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
  const note = (await store.noteById(n.id))!;
  await credit(investorC, 1_000_000n); // €10,000.00
  const before = await client.readContract({ address: LOCAL.assets.deposit.address, abi: BAL, functionName: "balanceOf", args: [investorC] });

  await assert.rejects(place.placeUnits(operator as any, n.id, id, 2, 100_000n), /buyer is not eligible for the note.*\(S-09, S-12\)/);
  assert.equal(await place.eligibleFor(note, investorC), false);
  await approveForNote(id, "depositAgent");
  assert.equal(await place.eligibleFor(note, investorC), true);
  await assert.rejects(onboarding.decideNote(operator as any, id, "approve"), /no request for the note waiting/);

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
  const id = await admitted("adm_test_seg3", "bank-custody", account, operator.id);
  await credit(account, 200_000n);
  await approveForNote(id, "custodian");
  const p = await place.placeUnits(operator as any, n.id, id, 1, 100_000n);
  assert.equal(p.status, "settled");
  assert.ok(p.settledTx);
  assert.equal(await client.readContract({ address: n.addresses.note as Address, abi: BAL, functionName: "balanceOf", args: [account] }), 1n);
  // The chain is the record: both placements, each settled.
  const offers = (await place.offersOf((await store.noteById(n.id))!)).map((x) => `${x.id}:${x.kind}:${x.status}`);
  assert.deepEqual(offers.sort(), ["1:placement:settled", "2:placement:settled"]);
});

// --- transfers, buy-backs and the inventory (ADR 0081; S-11 to S-14, S-16) ---

const NOTE_VIEWS = parseAbi(["function balanceOf(address) view returns (uint256)", "function getFrozenTokens(address) view returns (uint256)", "function totalSupply() view returns (uint256)"]);
const clientB = { ...operator, id: "reg_client_b", email: "treasury@second.example" };
const walletC = createWalletClient({ account: privateKeyToAccount("0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba"), transport: http(RPC) });
const walletB = createWalletClient({ account: privateKeyToAccount("0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a"), transport: http(RPC) });
/** Sends a client wallet's prepared transactions, as MetaMask would, and returns the last. */
async function send(wallet: typeof walletC, txs: Array<{ to: Address; data: `0x${string}`; label?: string }>) {
  let last: `0x${string}` = "0x";
  for (const t of txs) {
    last = await wallet.sendTransaction({ to: t.to, data: t.data, chain: null });
    const r = await client.waitForTransactionReceipt({ hash: last });
    assert.equal(r.status, "success", `${t.label ?? "a transaction"} succeeded`);
  }
  await new Promise((r) => setTimeout(r, 1600)); // past the lagging RPC's window
  return last;
}
const units = (n: { addresses: Record<string, string> }, a: Address) => client.readContract({ address: n.addresses.note as Address, abi: NOTE_VIEWS, functionName: "balanceOf", args: [a] });
const locked = (n: { addresses: Record<string, string> }, a: Address) => client.readContract({ address: n.addresses.note as Address, abi: NOTE_VIEWS, functionName: "getFrozenTokens", args: [a] });

test("S-11: transfers the bank arranges settle with each side acting as itself, locked until they do; S-12: a revoked buyer is refused", async () => {
  const n = (await store.listNotes()).find((x) => x.observations === 6 && x.status === "issued")!;
  const seg3 = LOCAL.custody.accounts["SEG-0003"] as Address;
  const investorC = LOCAL.parties.investorC as Address;
  const investorB = LOCAL.parties.investorB as Address;
  await admitted("adm_test_b", "self-custody", investorB, clientB.id);
  await credit(investorB, 1_000_000n);
  await credit(seg3, 500_000n);

  // A custody seller to a wallet: the custodian offers, the units locked in the account; the wallet buys in MetaMask.
  const r1 = await place.arrangeTrade(operator as any, n.id, { seller: "adm_test_seg3", buyer: "adm_test_c", units: 1, pricePerUnitCents: 90_000n });
  assert.equal(r1.offer?.status, "offered");
  assert.equal(await locked(n, seg3), 1n, "locked in the seller's own account");
  assert.equal((await place.offersFor(client3p as any)).toMe.length, 1, "shown to the buyer");
  await send(walletC, await place.acceptanceFor(client3p as any, n.id, r1.offer!.id, investorC));
  assert.equal((await place.refreshPlacement(n.id, r1.offer!.id, "0x"))?.status, "settled");
  assert.equal(await units(n, investorC), 3n);
  assert.equal(await units(n, seg3), 0n);
  assert.equal(await locked(n, seg3), 0n);

  // A wallet seller to a custody buyer: the custodian offers to buy, its price held; the wallet sells in MetaMask.
  const r2 = await place.arrangeTrade(operator as any, n.id, { seller: "adm_test_c", buyer: "adm_test_seg3", units: 1, pricePerUnitCents: 95_000n });
  assert.equal(r2.offer?.side, "buy");
  await send(walletC, await place.acceptanceFor(client3p as any, n.id, r2.offer!.id, investorC));
  assert.equal((await place.refreshPlacement(n.id, r2.offer!.id, "0x"))?.status, "settled");
  assert.equal(await units(n, seg3), 1n);

  // Two wallets: the arrangement waits for the seller's offer, which locks its units; the buyer accepts.
  const r3 = await place.arrangeTrade(operator as any, n.id, { seller: "adm_test_c", buyer: "adm_test_b", units: 1, pricePerUnitCents: 100_000n });
  assert.equal(r3.arranged?.status, "awaiting-seller");
  assert.equal((await place.offersFor(client3p as any)).arranged.length, 1);
  await assert.rejects(place.offerTxsFor(clientB as any, n.id, { arranged: r3.arranged!.ref }, investorB), /not open for this wallet/);
  const tx = await send(walletC, await place.offerTxsFor(client3p as any, n.id, { arranged: r3.arranged!.ref }, investorC));
  await place.walletActed(client3p as any, n.id, tx, r3.arranged!.ref);
  assert.equal(await locked(n, investorC), 1n);
  const toB = (await place.offersFor(clientB as any)).toMe;
  assert.equal(toB.length, 1);
  await send(walletB, await place.acceptanceFor(clientB as any, n.id, toB[0].offer.id, investorB));
  assert.equal(await units(n, investorB), 1n);
  assert.equal(await locked(n, investorC), 0n);

  // S-12: a buyer whose note claim is revoked is refused before anything is sent.
  await onboarding.revokeNote(operator as any, "adm_test_seg3", "Investor class under review");
  await new Promise((r) => setTimeout(r, 1600));
  await assert.rejects(place.arrangeTrade(operator as any, n.id, { seller: "adm_test_c", buyer: "adm_test_seg3", units: 1, pricePerUnitCents: 100_000n }), /buyer is not eligible for the note.*\(S-09, S-12\)/);
  await approveForNote("adm_test_seg3", "custodian");
});

test("open offers: a client offers to buy, another takes it; an offer to sell is locked until withdrawn", async () => {
  const n = (await store.listNotes()).find((x) => x.observations === 6 && x.status === "issued")!;
  const investorC = LOCAL.parties.investorC as Address;
  const investorB = LOCAL.parties.investorB as Address;
  const cashB = await client.readContract({ address: LOCAL.assets.deposit.address, abi: BAL, functionName: "balanceOf", args: [investorB] });
  await send(walletB, await place.offerTxsFor(clientB as any, n.id, { side: "buy", units: 1, pricePerUnitCents: 98_000n }, investorB));
  assert.equal(await client.readContract({ address: LOCAL.assets.deposit.address, abi: BAL, functionName: "balanceOf", args: [investorB] }), cashB - 98_000n, "the price is held");
  const open = (await place.offersFor(client3p as any)).open;
  assert.equal(open.length, 1, "shown to every approved client, without its maker");
  assert.equal((await place.offersFor(clientB as any)).mine.length, 1);
  await send(walletC, await place.acceptanceFor(client3p as any, n.id, open[0].offer.id, investorC));
  assert.equal(await units(n, investorB), 2n);

  // Investor B, now holding two, offers one to sell: locked in its wallet until it withdraws it.
  await send(walletB, await place.offerTxsFor(clientB as any, n.id, { side: "sell", units: 1, pricePerUnitCents: 99_000n }, investorB));
  assert.equal(await locked(n, investorB), 1n);
  await assert.rejects(place.offerTxsFor(clientB as any, n.id, { side: "sell", units: 2, pricePerUnitCents: 99_000n }, investorB), /has 1 units not already offered, not 2/);
  const mine = (await place.offersFor(clientB as any)).mine;
  await send(walletB, await place.cancelTxFor(clientB as any, n.id, mine[0].offer.id, investorB));
  assert.equal(await locked(n, investorB), 0n, "withdrawn, its lock released");
  assert.equal((await place.refreshPlacement(n.id, mine[0].offer.id, "0x"))?.status, "cancelled");
});

test("S-13: the Issuer buys units back into its inventory; S-14: no more can be cancelled than the inventory holds, unoffered", async () => {
  const n = (await store.listNotes()).find((x) => x.observations === 6 && x.status === "issued")!;
  const investorC = LOCAL.parties.investorC as Address;
  const issuer = LOCAL.parties.issuer as Address;
  const inventory = await units(n, issuer);
  const total = await client.readContract({ address: n.addresses.note as Address, abi: NOTE_VIEWS, functionName: "totalSupply" });

  const investorB = LOCAL.parties.investorB as Address;
  const b = await place.offerBuyback(operator as any, n.id, "adm_test_b", 1, 100_000n);
  assert.equal(b.kind, "buy-back");
  await send(walletB, await place.acceptanceFor(clientB as any, n.id, b.id, investorB));
  assert.equal(await units(n, issuer), inventory + 1n, "back in the inventory, pending");

  // An offer of the inventory locks those units: they cannot be cancelled meanwhile.
  const offered = await place.placeUnits(operator as any, n.id, "adm_test_c", 1, 100_000n);
  await assert.rejects(place.cancelFromInventory(operator as any, n.id, Number(inventory) + 1), /holds \d+ units not offered; \d+ cannot be cancelled \(S-14\)/);
  await place.cancelOffer(operator as any, n.id, offered.id);
  await place.cancelFromInventory(operator as any, n.id, 2);
  await new Promise((r) => setTimeout(r, 1600));
  assert.equal(await client.readContract({ address: n.addresses.note as Address, abi: NOTE_VIEWS, functionName: "totalSupply" }), total - 2n, "the note's total reduced");
});

// --- determinations, payments and closure (ADR 0078) ---

const life = await import("../lib/notes/lifecycle.ts");
const closeout = await import("../lib/notes/closeout.ts");
const SUPPLY = parseAbi(["function totalSupply() view returns (uint256)", "function paused() view returns (bool)"]);

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
  // Dates 30 minutes apart: the tests move the chain's clock to each, so no window lapses in real
  // time on a slow machine before a test reaches it.
  const started = await notes.startNote(operator as any, { scenario, observations: 4, interval: { value: 30, unit: "minutes" as const }, units: 10 });
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
  const open = await closeout.closeOutOf(n);
  assert.equal(open.closed, false, "not closed while units are outstanding");
  assert.equal(open.checks.find((c) => c.label === "Supply is zero")?.ok, false);
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
      // A holder the deposit cannot credit (the bank's claim revoked) is held for, not skipped (E3).
      await onboarding.revokeDeposit(operator as any, "adm_test_c", "Screening hit under review");
      await life.payEvent(operator as any, n.id, k, "coupon");
      view = await life.lifecycleOf((await store.noteById(n.id))!);
      const held = view.dates[k].events[0].payments.find((p) => p.holder.toLowerCase() === investorC.toLowerCase())!;
      assert.equal(held.held, true);
      assert.equal(view.dates[k].events[0].closed, true, "the event still closes for everyone else");
      await assert.rejects(life.claimHeld(operator as any, n.id, view.dates[k].events[0].id, investorC), /cannot yet receive/);
      // The deployment onboarded investor C itself, so the bank vouches again on the chain directly.
      await identities.vouch(onboarding.dataOf((await store.admissionById("adm_test_c"))!).identity!, "deposit", keccak256(toBytes("investor C, re-screened")));
      await new Promise((r) => setTimeout(r, 1600));
      const before = await deposit(investorC);
      await life.claimHeld(operator as any, n.id, view.dates[k].events[0].id, investorC);
      assert.equal(await deposit(investorC), before + 2_500n, "claimed once the bank's claim stands again");
      continue;
    }

    if (k === 2) {
      // S-16: after the Record Time, before the payment, investor C sells its unit to the custody
      // account. The coupon still goes to the holder of record; from date 4 the account holds three.
      await credit(custody, 100_000n);
      const t = await place.arrangeTrade(operator as any, n.id, { seller: "adm_test_c", buyer: "adm_test_seg3", units: 1, pricePerUnitCents: 100_000n });
      await send(walletC, await place.acceptanceFor(client3p as any, n.id, t.offer!.id, investorC));
      assert.equal(await units(n, investorC), 0n);
    }
    const [c0, w0] = await Promise.all([deposit(custody), deposit(investorC)]);
    await life.payEvent(operator as any, n.id, k, kinds[0]);
    const perUnit = k < 3 ? 2_500n : 60_000n; // €25 coupons; €600 at maturity, one unit below the barrier
    const [custodyUnits, cUnits] = k < 3 ? [2n, 1n] : [3n, 0n];
    assert.equal(await deposit(custody), c0 + custodyUnits * perUnit, `date ${k + 1}: the custody account's ${custodyUnits} units of record`);
    assert.equal(await deposit(investorC), w0 + cUnits * perUnit, `date ${k + 1}: investor C's ${cUnits} of record`);
    await assert.rejects(life.payEvent(operator as any, n.id, k, kinds[0]), /already paid/);
  }

  // Redeemed: the holders' units burned as they were paid, the inventory burned on closing.
  assert.equal(await client.readContract({ address: n.addresses.note as Address, abi: SUPPLY, functionName: "totalSupply" }), 0n);
  assert.equal(await client.readContract({ address: n.addresses.note as Address, abi: SUPPLY, functionName: "paused" }), true);
  assert.equal((await store.noteById(n.id))!.status, "closed");
  view = await life.lifecycleOf((await store.noteById(n.id))!);
  assert.equal(view.closed, true);
  // S-33: the close-out statement confirms every position at zero, with what each was paid.
  const statement = await closeout.closeOutOf((await store.noteById(n.id))!);
  assert.deepEqual(statement.checks.filter((c) => !c.ok), [], "every close-out check passes");
  assert.equal(statement.closed, true);
  assert.ok(statement.positions.every((p) => p.balance === "0"));
  assert.equal(statement.totals.units, "0");
  assert.equal(statement.totals.couponCents, String(3 * 3 * 2_500), "three coupons on three units of record");
  assert.equal(statement.totals.redemptionCents, String(3 * 60_000), "three units redeemed at €600");
  const pos = (a: Address) => statement.positions.find((p) => p.account.toLowerCase() === a.toLowerCase())!;
  assert.deepEqual([pos(custody).couponCents, pos(custody).redemptionCents], [String(3 * 2 * 2_500), String(3 * 60_000)]);
  assert.deepEqual([pos(investorC).unitsIn, pos(investorC).unitsOut, pos(investorC).couponCents], ["1", "1", String(3 * 2_500)]);
  const paid = await life.paymentsTo(custody);
  assert.deepEqual(paid.filter((p) => p.note.id === n.id).map((p) => `${p.kind}:${p.amount}`), ["coupon:5000", "coupon:5000", "coupon:5000", "redemption:180000"]);
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

// --- ETH for fees (ADR 0080) ---

test("a key that cannot pay its fees is refused before signing, named, warned about, and topped up from the best-funded key", async () => {
  const keys = await import("../lib/chain/keys.ts");
  const { signers } = await import("../lib/chain/signer.ts");
  const { defineChain } = await import("viem");
  const s = signers(defineChain({ id: 31337, name: "local", nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [RPC] } } }), RPC);
  const calc = s.address("calculationAgent");
  await client.request({ method: "anvil_setBalance" as any, params: [calc, "0x3e8"] as any }); // 1,000 wei

  const view = await keys.keyBalances(true);
  assert.equal(view.rows.find((r) => r.capacity === "calculationAgent")?.state, "empty");
  assert.equal(view.rows.find((r) => r.capacity === "servicing1")?.state, "signs-only");
  assert.ok((await keys.lowKeys()).some((r) => r.capacity === "calculationAgent"), "every staff portal warns of it");

  await assert.rejects(
    s.send("calculationAgent", { address: LOCAL.instruments.gateway, abi: GATEWAY, functionName: "credit", args: [LOCAL.parties.investorD, 1n, keccak256(toBytes("fees"))] }),
    /The Calculation Agent's key 0x[0-9a-fA-F]{40} holds 0\.000000000000001 ETH; this transaction needs about .* Top it up under Agent → Keys\./,
  );

  await assert.rejects(keys.topUp({ ...operator, email: "someone@corp.example" } as any, "calculationAgent"), /Not permitted/);
  await assert.rejects(keys.topUp(operator as any, "servicing1"), /only signs; it needs no ETH/);
  await keys.topUp(operator as any, "calculationAgent");
  await new Promise((r) => setTimeout(r, 1600));
  assert.equal(await client.getBalance({ address: calc }), 1_000n + keys.TOP_UP);
  assert.equal((await keys.keyBalances(true)).rows.find((r) => r.capacity === "calculationAgent")?.state, "ok");
});
