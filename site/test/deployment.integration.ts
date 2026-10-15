/**
 * Records belong to one deployment (ADR 0083): admissions and notes are stamped with the
 * deployment they act on, and an earlier deployment's are kept but never read.
 *
 *   npm run test:admission
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const REPO = join(import.meta.dirname, "..", "..");
const dir = mkdtempSync(join(tmpdir(), "deployment-"));
Object.assign(process.env, { NODE_ENV: "development", MANIFEST_PATH: join(REPO, "ops", "addresses.json"), FILE_STORE_DIR: dir });
const { getStore, currentDeployment } = await import("../lib/store.ts");
const LOCAL = JSON.parse(readFileSync(join(REPO, "ops", "addresses.json"), "utf8"));

const admission = (id: string, data: Record<string, unknown> = {}) => ({
  id, registrantId: "reg_x", route: "self-custody" as const, status: "onboarded" as const, createdAt: new Date().toISOString(),
  officerRequestId: null, walletRequestId: null, data,
});

test("an earlier deployment's admissions and notes are kept but not read; the current one's are stamped and read; clients carry over", async () => {
  const here = currentDeployment();
  assert.equal(here, `${LOCAL.chainId}:${LOCAL.identity.identityStorage.toLowerCase()}`);
  const store = getStore();

  // Rows written before deployments were recorded, or by another deployment.
  await store.putClient({ id: "cli_1", kycReference: "CLI-1", claims: {}, salt: `0x${"11".repeat(32)}`, recordHash: `0x${"22".repeat(32)}`, issuedAt: new Date().toISOString(), issuedBy: "op", createdAt: new Date().toISOString(), previous: [] });
  const file = join(dir, "store.json");
  const raw = JSON.parse(readFileSync(file, "utf8"));
  raw.admissions = [admission("adm_old"), admission("adm_other", { deployment: "84532:0xold" })];
  raw.notes = [{ id: "note_old", series: 2, name: "Old", symbol: "OLD", scenario: "x", units: 1, status: "issued", step: 0, createdAt: new Date().toISOString(), by: "op", addresses: {}, txs: {}, data: {} }];
  writeFileSync(file, JSON.stringify(raw));

  assert.equal(await store.admissionById("adm_old"), null);
  assert.equal(await store.admissionById("adm_other"), null);
  assert.deepEqual(await store.admissionsFor("reg_x"), []);
  assert.equal(await store.latestAdmissionFor("reg_x"), null);
  assert.deepEqual(await store.listAdmissions(10), []);
  assert.equal(await store.noteById("note_old"), null);
  assert.deepEqual(await store.listNotes(), []);

  // This deployment's: stamped on writing, read as usual.
  await store.putAdmission(admission("adm_new"));
  const a = (await store.admissionById("adm_new"))!;
  assert.equal(a.data.deployment, here);
  assert.equal((await store.latestAdmissionFor("reg_x"))?.id, "adm_new");
  assert.deepEqual((await store.listAdmissions(10)).map((x) => x.id), ["adm_new"]);
  assert.equal(await store.updateAdmission({ ...a, status: "offboarded", data: {} }, "onboarded"), true);
  assert.equal((await store.admissionById("adm_new"))?.data.deployment, here, "kept when the data is replaced");

  // The old rows are still there, as history.
  assert.equal(JSON.parse(readFileSync(file, "utf8")).admissions.length, 3);
  // The bank's clients are not a deployment's.
  assert.equal((await store.clientByReference("CLI-1"))?.id, "cli_1");
});
