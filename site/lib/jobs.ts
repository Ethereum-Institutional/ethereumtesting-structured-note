import "server-only";
import { randomBytes } from "node:crypto";
import { getStore, type Job, type Registrant } from "./store.ts";
import { hasRole } from "./operators.ts";

/**
 * Background jobs (ADR 0116): issuance and payment runs the server carries to their end with no
 * page open.
 *
 * - **A job is a row,** and so is a note being issued. A worker claims one step at a time, by
 *   version, so two workers never run the same step; a claim older than any request can run is
 *   taken over.
 * - **Each step is worked out from the chain,** so running one again after a crash is safe.
 * - **A failed step waits before it runs again,** longer each time, and after enough tries the job
 *   is marked failed with its reason, for staff to see.
 * - **What carries jobs forward:** the server, after answering the request that started or nudged
 *   them; every staff page load; and a daily cron, the most the Vercel Hobby plan allows.
 */

const now = () => new Date().toISOString();
/** Longer than a request may run (300 s): a claim this old belongs to a request that was stopped. */
const STALE_MS = 6 * 60_000;
/** Tries of one step before the job is marked failed. */
const MAX_ATTEMPTS = 8;

export type StepResult = { done: boolean; data?: Record<string, unknown> };

/** Runs one step of a job of the given kind. Loaded lazily: the steps import this module. */
async function step(job: Job): Promise<StepResult> {
  if (job.kind === "payment") return (await import("./notes/lifecycle.ts")).paymentStep(job);
  throw new Error(`no steps for jobs of kind ${job.kind}`);
}

export async function createJob(kind: Job["kind"], subject: string, by: string, data: Record<string, unknown>): Promise<Job> {
  const job: Job = { id: `job_${randomBytes(9).toString("base64url")}`, kind, subject, createdAt: now(), by, state: "queued", version: 0, attempts: 0, data };
  await getStore().putJob(job);
  return job;
}

const runnable = (j: Job, at = Date.now()) =>
  j.state === "queued" && (!j.claimedAt || at - Date.parse(j.claimedAt) > STALE_MS) && (!j.notBefore || Date.parse(j.notBefore) <= at);

/**
 * Claims and runs the job's next step. Returns the job as it then stands, or null where another
 * worker holds it or it is not due.
 */
export async function runStep(id: string): Promise<Job | null> {
  const store = getStore();
  const j = await store.jobById(id);
  if (!j || !runnable(j)) return null;
  const claimed: Job = { ...j, version: j.version + 1, claimedAt: now() };
  if (!(await store.updateJob(claimed, j.version))) return null;
  let next: Job;
  try {
    const r = await step(claimed);
    next = { ...claimed, version: claimed.version + 1, claimedAt: undefined, notBefore: undefined, attempts: 0, error: undefined, data: { ...claimed.data, ...(r.data ?? {}) }, state: r.done ? "done" : "queued" };
  } catch (e) {
    const attempts = claimed.attempts + 1;
    const error = (e as Error).message.split("\n")[0];
    const wait = Math.min(60_000, 2_000 * 2 ** attempts);
    next = { ...claimed, version: claimed.version + 1, claimedAt: undefined, attempts, error, notBefore: new Date(Date.now() + wait).toISOString(), state: attempts >= MAX_ATTEMPTS ? "failed" : "queued" };
    if (next.state === "failed") await store.audit({ at: now(), actor: "site", action: `a ${claimed.kind} job stopped after ${attempts} tries: ${error}`, subject: claimed.subject });
  }
  // Stopped meanwhile by staff: the stop stands.
  if (!(await store.updateJob(next, claimed.version))) return store.jobById(id);
  return next;
}

/**
 * Runs a job to its end in this request, for callers that wait for it: scripts and tests. A failed
 * step fails the job at once, with its reason, rather than waiting to try again.
 */
export async function runToEnd(id: string, budgetMs = 280_000): Promise<Job> {
  const store = getStore();
  const deadline = Date.now() + budgetMs;
  for (;;) {
    const j = (await store.jobById(id))!;
    if (j.state !== "queued" || Date.now() > deadline) return j;
    const r = await runStep(id);
    if (r?.error && r.state === "queued") {
      const failed = { ...r, version: r.version + 1, state: "failed" as const };
      await store.updateJob(failed, r.version);
      return failed;
    }
    if (!r) await new Promise((res) => setTimeout(res, 500));
  }
}

/**
 * Carries every job forward for up to `budgetMs`: notes being issued, then queued jobs, a step at a
 * time, until nothing is due or the time is spent.
 */
export async function runJobs(budgetMs = 240_000): Promise<{ steps: number }> {
  const store = getStore();
  const deadline = Date.now() + budgetMs;
  let steps = 0;
  const { advanceIssuance } = await import("./notes/issue.ts");
  // The index of the programme's events is brought up to date with every run.
  await (await import("./chain/events.ts")).syncIndex(true).catch(() => undefined);
  while (Date.now() < deadline) {
    let moved = false;
    for (const n of (await store.listNotes()).filter((x) => x.status === "issuing")) {
      if (Date.now() > deadline) break;
      const after = await advanceIssuance(n.id);
      // A step that failed waits for the next pass; one in flight belongs to another worker.
      if (after && (after.step !== n.step || after.status !== n.status) && !after.error) moved = true;
      steps++;
    }
    for (const j of await store.listJobs(50, true)) {
      if (Date.now() > deadline) break;
      if (!runnable(j)) continue;
      const r = await runStep(j.id);
      if (r && !r.error) moved = true;
      steps++;
    }
    if (!moved) break;
  }
  return { steps };
}

/**
 * Carries jobs forward after the current request has its answer. Outside a request (a script, a
 * test) there is no "after", and nothing is started.
 */
export async function kick(): Promise<void> {
  try {
    const { after } = await import("next/server");
    after(() => runJobs().catch(() => undefined));
  } catch {
    // not in a request
  }
}

/** Staff stop a job. Whatever already reached the chain stays there. */
export async function stopJob(staff: Registrant, id: string): Promise<void> {
  if (!hasRole(staff.email, "agent")) throw new Error("Not permitted.");
  const store = getStore();
  for (let tries = 0; tries < 5; tries++) {
    const j = await store.jobById(id);
    if (!j || j.state !== "queued") throw new Error("That job is not running.");
    if (await store.updateJob({ ...j, version: j.version + 1, state: "stopped", error: `Stopped by ${staff.email}` }, j.version)) {
      await store.audit({ at: now(), actor: staff.email, action: `stopped a ${j.kind} job`, subject: j.subject });
      return;
    }
  }
  throw new Error("The job moved on meanwhile; try again.");
}

/** The jobs for a subject, newest first, for its page. */
export async function jobsFor(subject: string): Promise<Job[]> {
  return (await getStore().listJobs(200)).filter((j) => j.subject === subject);
}
