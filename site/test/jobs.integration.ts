/**
 * Background jobs and the per-key send lease (ADR 0116), against the local chain: two servers sending
 * with one key at once each get their own nonce, and two workers never run the same step.
 *
 *   ../ops/reset.sh && npm run test:admission
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineChain, parseEther } from "viem";

const REPO = join(import.meta.dirname, "..", "..");
const RPC = process.env.RPC_URL ?? "http://127.0.0.1:8545";
process.chdir(mkdtempSync(join(tmpdir(), "jobs-"))); // a fresh development store
Object.assign(process.env, { NODE_ENV: "development", MANIFEST_PATH: join(REPO, "ops", "addresses.json"), RPC_URL: RPC, OPERATOR_EMAILS: "operator@example.org", AGENT_EMAILS: "" });
const { signers } = await import("../lib/chain/signer.ts");
const jobs = await import("../lib/jobs.ts");
const { getStore } = await import("../lib/store.ts");
const chain = defineChain({ id: 31337, name: "local", nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [RPC] } } });

test("two servers sending with one key at once take turns under its lease, each with its own nonce", async () => {
  // Two signer sets stand for two server instances: each has its own in-memory queue and nonce state.
  const [a, b] = [signers(chain, RPC), signers(chain, RPC)];
  const to = "0x00000000000000000000000000000000000c0ffe" as const;
  const before = await a.publicClient.getTransactionCount({ address: a.address("agent") });
  const hashes = await Promise.all([a.transfer("agent", to, parseEther("0.001")), b.transfer("agent", to, parseEther("0.001")), a.transfer("agent", to, parseEther("0.001"))]);
  const txs = await Promise.all(hashes.map((hash) => a.publicClient.getTransaction({ hash })));
  assert.deepEqual(txs.map((t) => t.nonce).sort((x, y) => x - y), [before, before + 1, before + 2], "three nonces, none reused, none skipped");
  assert.equal(await a.publicClient.getTransactionCount({ address: a.address("agent") }), before + 3);
});

test("a lease another holder has is refused until it is given back; the next holder finds what it kept", async () => {
  const store = getStore();
  assert.deepEqual(await store.takeLease("test:lease", "one", 60_000), {});
  assert.equal(await store.takeLease("test:lease", "two", 60_000), null, "held by another");
  await store.releaseLease("test:lease", "one", { nextNonce: 7 });
  assert.deepEqual(await store.takeLease("test:lease", "two", 60_000), { nextNonce: 7 });
  await store.releaseLease("test:lease", "two", { nextNonce: 7 });
  // A lease past its time is taken over, as when its server was stopped mid-send.
  await store.takeLease("test:stale", "gone", 1);
  await new Promise((r) => setTimeout(r, 20));
  assert.notEqual(await store.takeLease("test:stale", "next", 60_000), null);
});

test("two workers asking for the same step at once: one runs it, the other leaves it; a failed step waits, and staff can stop the job", async () => {
  const job = await jobs.createJob("payment", "note_that_does_not_exist", "operator@example.org", { date: 0, event: "coupon", txs: [] });
  const [x, y] = await Promise.all([jobs.runStep(job.id), jobs.runStep(job.id)]);
  assert.equal([x, y].filter(Boolean).length, 1, "only one worker ran it");
  const after = (x ?? y)!;
  assert.equal(after.state, "queued", "a failed step is tried again later");
  assert.match(after.error ?? "", /no longer on record/);
  assert.ok(after.notBefore && Date.parse(after.notBefore) > Date.now(), "not before a wait");
  assert.equal(await jobs.runStep(job.id), null, "not due yet");
  const operator = { id: "reg_operator", email: "operator@example.org", name: "Operator", organisation: "The Bank", status: "approved" as const, createdAt: new Date().toISOString(), verifiedAt: null, decidedAt: null, decidedBy: null };
  await jobs.stopJob(operator as any, job.id);
  assert.equal((await getStore().jobById(job.id))?.state, "stopped");
  await assert.rejects(jobs.stopJob(operator as any, job.id), /not running/);
});
