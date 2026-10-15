/**
 * Governance from the site, against the local chain (ADRs 0082, 0088): Tier 1 by the Agent's governance
 * wallet alone, Tier 2 by the institutions' wallets with their thresholds, delay and execution
 * window, each wallet signing as itself through the lagging RPC.
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

test("S-25, Tier 1: the Agent's governance wallet corrects the register at once, its written reason on-chain; none without a reason", async () => {
  const [a, b] = await Promise.all([units(investorA), units(investorB)]);
  await assert.rejects(gov.correctRegister(operator as any, { from: investorA, to: investorB, units: 1, reason: " " }), /written reason is required/);
  await assert.rejects(gov.correctRegister({ ...operator, email: "someone@corp.example" } as any, { from: investorA, to: investorB, units: 1, reason: "x" }), /Not permitted/);
  await gov.correctRegister(operator as any, { from: investorA, to: investorB, units: 1, reason: "Lost key reported by investor A; one unit restored to the Register's holder" });
  await settle();
  assert.equal(await units(investorA), a - 1n);
  assert.equal(await units(investorB), b + 1n);
  const record = (await gov.governanceView()).tier1;
  assert.equal(record[0].action, "correctRegister");
  assert.match(record[0].reason, /Lost key reported by investor A/);
});

test("S-25, Tier 1: a lost wallet's units are recovered to the holder's new wallet, its identity moving with them", async () => {
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

test("Tier 1: an account is frozen at once, whichever institution vouched for it, and unfrozen", async () => {
  const FROZEN = parseAbi(["function isFrozen(address) view returns (bool)"]);
  await gov.withdraw(operator as any, { what: "freeze", account: investorB, reason: "Sanctions designation under review" });
  await settle();
  assert.equal(await client.readContract({ address: note, abi: FROZEN, functionName: "isFrozen", args: [investorB] }), true);
  await gov.withdraw(operator as any, { what: "unfreeze", account: investorB, reason: "Designation cleared" });
  await settle();
  assert.equal(await client.readContract({ address: note, abi: FROZEN, functionName: "isFrozen", args: [investorB] }), false);
});

test("S-26: the Agent forcing a transfer outside the control framework is refused; only the controller holds the right", async () => {
  const said = await gov.attemptAgentForcedTransfer(operator as any);
  assert.match(said, /Only the governance controller may force a transfer \(S-26\)/);
  assert.match(said, /servicing wallet may force a transfer: no; the controller: yes/);
});

test("S-22, Tier 2: one institution cannot queue a proposal; two, with four signatures, queue it, and it executes after the delay", async () => {
  const before = await client.readContract({ address: note, abi: NOTE, functionName: "totalSupply" });
  await assert.rejects(gov.propose(operator as any, { by: "issuer", kind: "ReplaceInstitution", reason: "x" }), /not offered from the site/);
  const { id } = await gov.propose(operator as any, { by: "issuer", kind: "AmendNotional", increase: true, units: 2, reason: "Tranche up by two units for a new subscription" });
  let p = await proposal(id);
  assert.equal(p.state, "awaiting approvals", "the Issuer alone does not queue it");
  assert.deepEqual([p.institutions, p.signatures], [1, 2]);
  await assert.rejects(gov.execute(operator as any, id), /Not queued: the thresholds are not met yet \(S-22\)/);
  await assert.rejects(gov.approve(operator as any, id, "issuer"), /already approved/);

  await gov.approve(operator as any, id, "cosigner");
  p = await proposal(id);
  assert.equal(p.state, "queued");
  assert.deepEqual([p.institutions, p.signatures], [2, 4]);
  await assert.rejects(gov.execute(operator as any, id), /Not ready: executable from/);

  await warpTo(p.readyAt);
  assert.equal((await proposal(id)).state, "executable");
  await gov.execute(operator as any, id);
  await settle();
  assert.equal(await client.readContract({ address: note, abi: NOTE, functionName: "totalSupply" }), before + 2n, "minted into the inventory");
  assert.equal((await proposal(id)).state, "executed");
});

test("S-24, Tier 2: a queued proposal left unexecuted past its window expires, and can no longer be executed or approved", async () => {
  const view = await gov.governanceView();
  assert.equal(view.executionWindow, 86_400, "one day on the local stack");
  const { id } = await gov.propose(operator as any, { by: "agent", kind: "SetTrustedIssuer", account: "0x00000000000000000000000000000000000d3a1e" as Address, approved: true, reason: "Trust a dealer's claim issuer for the note" });
  await gov.approve(operator as any, id, "issuer");
  const p = await proposal(id);
  assert.equal(p.expiresAt, p.readyAt + 86_400);
  await warpTo(p.expiresAt! + 1);
  assert.equal((await proposal(id)).state, "expired");
  await assert.rejects(gov.execute(operator as any, id), /Expired at .* must be proposed afresh \(S-24\)/);
  await assert.rejects(gov.approve(operator as any, id, "cosigner"), /Expired/);
});

test("Tier 2: the proposing institution cancels its proposal; no other may", async () => {
  const { id } = await gov.propose(operator as any, { by: "cosigner", kind: "AmendNotional", increase: false, units: 1, reason: "Reduce by one unit" });
  await gov.cancel(operator as any, id);
  await settle();
  assert.equal((await proposal(id)).state, "cancelled");
  await assert.rejects(gov.approve(operator as any, id, "agent"), /no longer open/);
});

test("Tier 2: trusting a further claim issuer for the note, executed through the controller", async () => {
  const issuer = "0x0000000000000000000000000000000000000de1" as Address;
  const { id } = await gov.propose(operator as any, { by: "agent", kind: "SetTrustedIssuer", account: issuer, approved: true, reason: "A second onboarding agent appointed" });
  await gov.approve(operator as any, id, "cosigner");
  await warpTo((await proposal(id)).readyAt);
  await gov.execute(operator as any, id);
  await settle();
  const view = await gov.governanceView();
  assert.ok(view.trustedIssuers.some((a) => a.toLowerCase() === issuer.toLowerCase()), "the note now trusts it");
  assert.match((await proposal(id)).args, /Trust 0x0+de1 for the note/i);
});
