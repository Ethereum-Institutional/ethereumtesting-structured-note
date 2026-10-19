/**
 * Governance from the site, against the local chain: one controller for every note. Tier 1 by the
 * Agent's governance wallet alone, on the note named or every note; Tier 2 by the institutions'
 * wallets with their thresholds, delay and execution window, each wallet signing as itself through
 * the lagging RPC; and a determination corrected.
 *
 *   ../ops/reset.sh && npm run test:admission
 */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPublicClient, http, parseAbi, type Address } from "viem";
import { startLaggingRpc } from "./lagging-rpc.ts";

const REPO = join(import.meta.dirname, "..", "..");
const RPC = process.env.RPC_URL ?? "http://127.0.0.1:8545";
const lagging = await startLaggingRpc(4051, RPC);
after(() => lagging.close());

process.chdir(mkdtempSync(join(tmpdir(), "governance-"))); // a fresh development store
Object.assign(process.env, { NODE_ENV: "development", MANIFEST_PATH: join(REPO, "ops", "addresses.json"), RPC_URL: lagging.url, OPERATOR_EMAILS: "operator@example.org", BANK_EMAILS: "", ONBOARDING_EMAILS: "", AGENT_EMAILS: "", CUSTODIAN_EMAILS: "" });
const gov = await import("../lib/governance.ts");
const LOCAL = JSON.parse(readFileSync(join(REPO, "ops", "addresses.json"), "utf8"));
const operator = { id: "reg_operator", email: "operator@example.org", name: "Operator", organisation: "The Bank", status: "approved" as const, createdAt: new Date().toISOString(), verifiedAt: null, decidedAt: null, decidedBy: null };
const client = createPublicClient({ transport: http(RPC) });
const NOTE = parseAbi(["function balanceOf(address) view returns (uint256)", "function totalSupply() view returns (uint256)"]);
const note = LOCAL.instruments.note as Address;
const investorA = LOCAL.parties.investorA as Address;
const investorB = LOCAL.parties.investorB as Address;
const units = (a: Address) => client.readContract({ address: note, abi: NOTE, functionName: "balanceOf", args: [a] });
const settle = () => new Promise((r) => setTimeout(r, 1600)); // past the lagging RPC's window

/** Moves the local chain's clock to just past `t`, and mines a block there. */
async function warpTo(t: number) {
  const latest = Number((await client.getBlock()).timestamp);
  if (latest <= t) await client.request({ method: "evm_increaseTime" as any, params: [t - latest + 1] as any });
  await client.request({ method: "evm_mine" as any, params: [] as any });
  await settle();
}
const proposal = async (id: number) => (await gov.governanceView()).proposals.find((p) => p.id === id)!;

test("Tier 1: the Agent's governance wallet corrects a note's register at once, its written reason on-chain; none without a reason", async () => {
  const [a, b] = await Promise.all([units(investorA), units(investorB)]);
  await assert.rejects(gov.correctRegister(operator as any, { token: note, from: investorA, to: investorB, units: 1, reason: " " }), /written reason is required/);
  await assert.rejects(gov.correctRegister({ ...operator, email: "someone@corp.example" } as any, { token: note, from: investorA, to: investorB, units: 1, reason: "x" }), /Not permitted/);
  await gov.correctRegister(operator as any, { token: note, from: investorA, to: investorB, units: 1, reason: "Lost key reported by investor A; one unit restored to the Register's holder" });
  await settle();
  assert.equal(await units(investorA), a - 1n);
  assert.equal(await units(investorB), b + 1n);
  const record = (await gov.governanceView()).tier1;
  assert.equal(record[0].action, "correctRegister");
  assert.equal(record[0].note, LOCAL.assets.note.symbol, "the record names the note");
  assert.match(record[0].reason, /Lost key reported by investor A/);
});

test("Tier 1: a lost wallet's units are recovered to the holder's new wallet, its identity moving with them", async () => {
  const REGISTRY = parseAbi(["function identity(address) view returns (address)"]);
  const held = await units(investorA);
  const identity = await client.readContract({ address: LOCAL.noteSuite.identityRegistry, abi: REGISTRY, functionName: "identity", args: [investorA] });
  const replacement = "0x00000000000000000000000000000000000a11ce" as Address;
  await gov.recoverWallet(operator as any, { lost: investorA, replacement, reason: "Investor A reported its key lost; units recovered to its new wallet" });
  await settle();
  assert.equal(await units(replacement), held);
  assert.equal(await units(investorA), 0n);
  const moved = await client.readContract({ address: LOCAL.noteSuite.identityRegistry, abi: REGISTRY, functionName: "identity", args: [replacement] });
  assert.equal(moved.toLowerCase(), identity.toLowerCase(), "the identity is the new wallet's");
  // And back, so later tests find investor A as they expect.
  await gov.recoverWallet(operator as any, { lost: replacement, replacement: investorA, reason: "Restored for the test" });
  await settle();
  assert.equal(await units(investorA), held);
});

test("Tier 1: an account is frozen at once on every note, whichever institution vouched for it, and unfrozen", async () => {
  const FROZEN = parseAbi(["function isFrozen(address) view returns (bool)"]);
  const every = (await gov.governedNotes()).map((n) => n.address);
  const frozen = () => Promise.all(every.map((t) => client.readContract({ address: t, abi: FROZEN, functionName: "isFrozen", args: [investorB] })));
  await gov.withdraw(operator as any, { what: "freeze", account: investorB, everyNote: true, reason: "Sanctions designation under review" });
  await settle();
  assert.ok((await frozen()).every(Boolean), `frozen on all ${every.length} notes`);
  await gov.withdraw(operator as any, { what: "unfreeze", account: investorB, everyNote: true, reason: "Designation cleared" });
  await settle();
  assert.ok((await frozen()).every((f) => !f));
});

test("Tier 1: a sanctions designation stops an account on every note at once, until it is lifted", async () => {
  const CAN = parseAbi(["function canTransfer(address from, address to, uint256 amount) view returns (bool)", "function compliance() view returns (address)"]);
  const COMPLIANCE = parseAbi(["function canTransfer(address from, address to, uint256 amount) view returns (bool)"]);
  const compliance = await client.readContract({ address: note, abi: CAN, functionName: "compliance" });
  const may = () => client.readContract({ address: compliance, abi: COMPLIANCE, functionName: "canTransfer", args: [investorA, investorB, 1n] });
  assert.equal(await may(), true);
  await gov.withdraw(operator as any, { what: "designate", account: investorB, reason: "Designated on the consolidated list" });
  await settle();
  assert.equal(await may(), false, "nothing moves to a designated account");
  await gov.withdraw(operator as any, { what: "undesignate", account: investorB, reason: "Delisted" });
  await settle();
  assert.equal(await may(), true);
});

test("the Agent forcing a transfer outside the control framework is refused; only the controller holds the right", async () => {
  const said = await gov.attemptAgentForcedTransfer(operator as any);
  assert.match(said, /refused/);
  assert.match(said, /servicing wallet may force a transfer: no; the controller: yes/);
});

test("Tier 2: one institution cannot queue a proposal; two, with four signatures, queue it, and it executes after the delay", async () => {
  const before = await client.readContract({ address: note, abi: NOTE, functionName: "totalSupply" });
  await assert.rejects(gov.propose(operator as any, { by: "issuer", kind: "ReplaceInstitution", reason: "x" }), /not offered from the site/);
  const { id } = await gov.propose(operator as any, { by: "issuer", kind: "AmendNotional", token: note, increase: true, units: 2, reason: "Tranche up by two units for a new subscription" });
  let p = await proposal(id);
  assert.equal(p.state, "awaiting approvals", "the Issuer alone does not queue it");
  assert.deepEqual([p.institutions, p.signatures], [1, 2]);
  await assert.rejects(gov.execute(operator as any, id), /Not queued: not enough institutions have approved it yet/);
  await assert.rejects(gov.approve(operator as any, id, "issuer"), /already approved/);

  await gov.approve(operator as any, id, "cosigner");
  p = await proposal(id);
  assert.equal(p.state, "queued");
  assert.deepEqual([p.institutions, p.signatures], [2, 4]);
  await assert.rejects(gov.execute(operator as any, id), /Not ready: it can be executed from/);

  await warpTo(p.readyAt);
  assert.equal((await proposal(id)).state, "executable");
  await gov.execute(operator as any, id);
  await settle();
  assert.equal(await client.readContract({ address: note, abi: NOTE, functionName: "totalSupply" }), before + 2n, "minted into the inventory");
  assert.equal((await proposal(id)).state, "executed");
});

test("Tier 2: a queued proposal left unexecuted past its window expires, and can no longer be executed or approved", async () => {
  const view = await gov.governanceView();
  assert.equal(view.executionWindow, 86_400, "one day on the local stack");
  const { id } = await gov.propose(operator as any, { by: "agent", kind: "SetTrustedIssuer", token: note, account: "0x00000000000000000000000000000000000d3a1e" as Address, approved: true, reason: "Trust a dealer's claim issuer for the note" });
  await gov.approve(operator as any, id, "issuer");
  const p = await proposal(id);
  assert.equal(p.expiresAt, p.readyAt + 86_400);
  await warpTo(p.expiresAt! + 1);
  assert.equal((await proposal(id)).state, "expired");
  await assert.rejects(gov.execute(operator as any, id), /expired at .* must be proposed again/);
  await assert.rejects(gov.approve(operator as any, id, "cosigner"), /expired/);
});

test("Tier 2: the proposing institution cancels its proposal; no other may", async () => {
  const { id } = await gov.propose(operator as any, { by: "cosigner", kind: "AmendNotional", token: note, increase: false, units: 1, reason: "Reduce by one unit" });
  await gov.cancel(operator as any, id);
  await settle();
  assert.equal((await proposal(id)).state, "cancelled");
  await assert.rejects(gov.approve(operator as any, id, "agent"), /no longer open/);
});

test("Tier 2: trusting a further claim issuer for the note, executed through the controller", async () => {
  const issuer = "0x0000000000000000000000000000000000000de1" as Address;
  const { id } = await gov.propose(operator as any, { by: "agent", kind: "SetTrustedIssuer", token: note, account: issuer, approved: true, reason: "A second onboarding agent appointed" });
  await gov.approve(operator as any, id, "cosigner");
  await warpTo((await proposal(id)).readyAt);
  await gov.execute(operator as any, id);
  await settle();
  const view = await gov.governanceView();
  assert.ok(view.trustedIssuers.some((a) => a.toLowerCase() === issuer.toLowerCase()), "the note now trusts it");
  const p = await proposal(id);
  assert.match(p.args, /Trust 0x0+de1/i);
  assert.equal(p.note, LOCAL.assets.note.symbol);
});

test("Tier 2: a determination is corrected before anything is paid, as the Calculation Agent signs it again", async () => {
  const DET = parseAbi([
    "function nextDate() view returns (uint256)",
    "function observation(uint256) view returns ((uint48 date, uint48 recordTime, uint48 paymentDate, bool coupon, bool mer, bool barrier, bool isFinal, uint32 merTriggerBps))",
    "function compute(uint256 dateIndex, uint256[] levels) view returns ((bool breached, bool couponPaid, uint64 couponPerCa, bool redeemed, uint64 redemptionPerCa, uint8 worstIndex) out, uint256 missedAfter)",
    "function digest(uint256 dateIndex, uint256[] levels, (bool breached, bool couponPaid, uint64 couponPerCa, bool redeemed, uint64 redemptionPerCa, uint8 worstIndex) o) view returns (bytes32)",
    "function determine(uint256 dateIndex, uint256[] levels, (bool breached, bool couponPaid, uint64 couponPerCa, bool redeemed, uint64 redemptionPerCa, uint8 worstIndex) claimed, bytes signature)",
    "function outcomeOf(uint256 dateIndex) view returns ((bool breached, bool couponPaid, uint64 couponPerCa, bool redeemed, uint64 redemptionPerCa, uint8 worstIndex))",
  ]);
  const da = LOCAL.lifecycle.determinations as Address;
  if ((await client.readContract({ address: da, abi: DET, functionName: "nextDate" })) !== 0n) return; // determined already by an earlier run
  await assert.rejects(gov.previewCorrection(note, [1n]), /No date of this note has been determined yet/);
  // The first date, determined with Levels at half the initial: below the coupon barrier, no coupon.
  const obs = await client.readContract({ address: da, abi: DET, functionName: "observation", args: [0n] });
  await warpTo(Number(obs.date));
  const view = await gov.governanceView(note);
  const { signers } = await import("../lib/chain/signer.ts");
  const { defineChain } = await import("viem");
  const s = signers(defineChain({ id: LOCAL.chainId, name: "local", nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [RPC] } } }), RPC);
  const TERMS = parseAbi(["function terms() view returns ((uint256[] initialLevels, uint64 calculationAmountCents, uint32 couponBarrierBps, uint32 couponRateBps, bool memory_, uint32 barrierBps, (bool applies, uint32 upBps, uint32 downBps, uint32 capBps) twinWin, (uint48 date, uint48 recordTime, uint48 paymentDate, bool coupon, bool mer, bool barrier, bool isFinal, uint32 merTriggerBps)[] schedule) t)"]);
  const initial = [...(await client.readContract({ address: da, abi: TERMS, functionName: "terms" })).initialLevels];
  const low = initial.map((l) => (l * 50n) / 100n);
  const [out] = await client.readContract({ address: da, abi: DET, functionName: "compute", args: [0n, low] });
  assert.equal(out.couponPaid, false);
  const sig = await s.signHash("calculationAgent", await client.readContract({ address: da, abi: DET, functionName: "digest", args: [0n, low, out] }));
  await s.send("calculationAgent", { address: da, abi: DET, functionName: "determine", args: [0n, low, out, sig] });
  await settle();
  assert.equal(view.note.nextDate, 0, "read before the determination");

  // The Levels were misread: at 85% of the initial Levels the coupon is due, and the note does not
  // redeem early, which needs every Level at its initial.
  const corrected = initial.map((l) => (l * 85n) / 100n);
  const preview = await gov.previewCorrection(note, corrected);
  assert.equal(preview.outcome.couponPaid, true);
  assert.equal(preview.outcome.redeemed, false);
  assert.equal(preview.coupon.closed, false, "nothing paid yet: no reversal");
  const { id } = await gov.propose(operator as any, { by: "agent", kind: "CorrectDetermination", token: note, levels: corrected, reason: "Levels taken from the wrong fixing page" });
  await gov.approve(operator as any, id, "issuer");
  await warpTo((await proposal(id)).readyAt);
  await gov.execute(operator as any, id);
  await settle();
  const now = await client.readContract({ address: da, abi: DET, functionName: "outcomeOf", args: [0n] });
  assert.equal(now.couponPaid, true, "the corrected outcome stands");
  assert.match((await proposal(id)).args, /Date 1 to Levels/);
});
