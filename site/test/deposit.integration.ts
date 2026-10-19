/**
 * The bank's tokenized deposit from the site, against the local chain: credit and
 * debit against bookings, a hold on part of a balance, the pause, and a move by order with its
 * reason, each read back from the chain through the lagging RPC, and the bank's view of it all.
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
const lagging = await startLaggingRpc(4061, RPC);
after(() => lagging.close());

process.chdir(mkdtempSync(join(tmpdir(), "deposit-"))); // a fresh development store
Object.assign(process.env, { NODE_ENV: "development", MANIFEST_PATH: join(REPO, "ops", "addresses.json"), RPC_URL: lagging.url, OPERATOR_EMAILS: "operator@example.org", BANK_EMAILS: "", ONBOARDING_EMAILS: "", AGENT_EMAILS: "", CUSTODIAN_EMAILS: "" });
const deposit = await import("../lib/identity/deposit.ts");
const { until } = await import("../lib/chain/until.ts");
const LOCAL = JSON.parse(readFileSync(join(REPO, "ops", "addresses.json"), "utf8"));
const chain = createPublicClient({ transport: http(RPC) });
const TOKEN = parseAbi(["function balanceOf(address) view returns (uint256)", "function getFrozenTokens(address) view returns (uint256)", "function paused() view returns (bool)"]);
const token = LOCAL.assets.deposit.address as Address;
const investorC = LOCAL.parties.investorC as Address; // onboarded for cash only
const investorA = LOCAL.parties.investorA as Address;
const investorD = LOCAL.parties.investorD as Address; // onboarded nowhere
const balance = (a: Address) => chain.readContract({ address: token, abi: TOKEN, functionName: "balanceOf", args: [a] });

test("the bank credits and debits against bookings; a held amount cannot be debited; released, it can", async () => {
  const before = await balance(investorC);
  const credit = await deposit.creditDeposit(investorC, 100_00n);
  assert.match(credit.bookingRef, /^BKG-\d{6}-[0-9A-F]{8}$/);
  await until(() => balance(investorC), (b) => b === before + 100_00n);

  await deposit.holdDeposit(investorC, before + 60_00n);
  await assert.rejects(deposit.debitDeposit(investorC, 50_00n), /does not hold that much free/);
  const debit = await deposit.debitDeposit(investorC, 40_00n);
  assert.notEqual(debit.bookingRef, credit.bookingRef, "each booking its own reference");
  await until(() => balance(investorC), (b) => b === before + 60_00n);
  await deposit.holdDeposit(investorC, 0n);
  assert.equal(await chain.readContract({ address: token, abi: TOKEN, functionName: "getFrozenTokens", args: [investorC] }), 0n, "released");
  await deposit.debitDeposit(investorC, 60_00n);
  await until(() => balance(investorC), (b) => b === before);
});

test("the pause stops credits and debits; resumed, they move", async () => {
  await deposit.setPaused(true);
  await assert.rejects(deposit.setPaused(true), /paused already/);
  await assert.rejects(deposit.creditDeposit(investorC, 1_00n), /paused/);
  await deposit.setPaused(false);
  await deposit.creditDeposit(investorC, 1_00n);
});

test("a move by order carries its reason, moves a held amount, and never to an account the bank does not know", async () => {
  await deposit.creditDeposit(investorC, 30_00n);
  const held = (await balance(investorC)) - 0n;
  await deposit.holdDeposit(investorC, held);
  const toBefore = await balance(investorA);
  await assert.rejects(deposit.enforce(investorC, investorA, 10_00n, "  "), /Give the order/);
  await assert.rejects(deposit.enforce(investorC, investorD, 10_00n, "Order to an unknown account"), /cannot hold the deposit/);
  await deposit.enforce(investorC, investorA, 10_00n, "Court order 2026/117: attachment in favour of investor A");
  await until(() => balance(investorA), (b) => b === toBefore + 10_00n);
  await deposit.holdDeposit(investorC, 0n);
});

test("the bank's view: the supply, each holder and why it may hold, the bookings with their references, and the orders", async () => {
  const view = await until(() => deposit.depositView(), (v) => v.enforcements.length > 0);
  assert.equal(view.paused, false);
  assert.ok(view.supply > 0n);
  const c = view.holders.find((h) => h.account.toLowerCase() === investorC.toLowerCase());
  assert.equal(c?.why, "identity", "investor C holds by the bank's claim");
  assert.ok(view.holders.some((h) => h.why === "allowlist"), "the lifecycle contracts hold by the allowlist");
  assert.ok(view.holders.every((h) => h.balance > 0n || h.held > 0n), "only accounts holding something");
  // These bookings were made here without the site's audit log, so only their hashes are known.
  const debit = view.bookings.find((b) => b.kind === "debit");
  assert.ok(debit && debit.ref === null && /^0x[0-9a-f]{64}$/i.test(debit.refHash));
  assert.match(view.enforcements[0].reason, /Court order 2026\/117/);
  assert.equal(view.enforcements[0].toLabel, "Investor A");
});
