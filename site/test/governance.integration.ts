/**
 * Governance from the site, against the local chain (ADR 0082): Tier 1 by the Agent's governance
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
const lagging = await startLaggingRpc(4041, RPC);
after(() => lagging.close());

process.chdir(mkdtempSync(join(tmpdir(), "governance-"))); // a fresh development store
Object.assign(process.env, { NODE_ENV: "development", MANIFEST_PATH: join(REPO, "ops", "addresses.json"), RPC_URL: lagging.url, OPERATOR_EMAILS: "operator@example.org" });
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

test("S-26: the Agent forcing a transfer outside the control framework is refused; only the controller holds the right", async () => {
  const said = await gov.attemptAgentForcedTransfer(operator as any);
  assert.match(said, /Only the governance controller may force a transfer \(S-26\)/);
  assert.match(said, /servicing wallet holds the forced-transfer right: no; the controller: yes/);
});

test("S-22, Tier 2: one institution cannot queue a proposal; two, with four signatures, queue it, and it executes after the delay", async () => {
  const before = await client.readContract({ address: note, abi: NOTE, functionName: "totalSupply" });
  await assert.rejects(gov.propose(operator as any, { by: "issuer", kind: "Upgrade", reason: "x" }), /not offered from the site/);
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
  const { id } = await gov.propose(operator as any, { by: "agent", kind: "SetMaxValidity", days: 300, reason: "Shorten the longest grant to 300 days" });
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
