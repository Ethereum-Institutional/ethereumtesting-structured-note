/**
 * Demonstration notes against the local chain (ADR 0072): issued from the site, step by step,
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

test("a demonstration note is issued from the site, step by step, on the live note's implementation", async () => {
  await assert.rejects(notes.startDemoNote({ ...operator, email: "someone@corp.example" } as any, { scenario: "mer-at-trigger", spacingMinutes: 5, units: 20 }), /Not permitted/);
  await assert.rejects(notes.startDemoNote(operator as any, { scenario: "nope", spacingMinutes: 5, units: 20 }), /Choose a scenario/);
  const started = await notes.startDemoNote(operator as any, { scenario: "mer-at-trigger", spacingMinutes: 5, units: 20 });
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
