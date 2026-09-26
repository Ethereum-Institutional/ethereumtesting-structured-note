import "server-only";
import { randomBytes } from "node:crypto";
import { canonicalString } from "./canonical.ts";
import { assess, type Assessment, type Received } from "./assess.ts";
import { writeGrants } from "./grants.ts";
import {
  corporateIdentity,
  lodge,
  protocolConfig,
  signedRequest,
  verdictFor,
  type Presentation,
  type Step,
  type VerifierRequest,
} from "./protocol.ts";
import { loadManifest } from "../chain/manifest.ts";
import { getStore, type Admission, type Registrant } from "../store.ts";
import { emailList, isOperator } from "../operators.ts";
import { sendMail } from "../mail.ts";

/**
 * Admission to the conversion pool (ADRs 0045 to 0048, 0052).
 *
 * 1. A signed-in participant starts an admission. The site signs a request for the officer
 *    credential and lodges it with the hosted verifier; its address is shown as a QR code.
 * 2. The officer's wallet posts the presentation to the callback. The site checks that the
 *    embedded request is the one it signed, obtains the verdict, keeps both, and on a grant signs
 *    the second request, for the wallet-control credential.
 * 3. The wallet presentation arrives the same way. The site fetches the corporation's corporate
 *    identity and assesses the three together.
 * 4. An operator approves or declines; on approval the site writes both grants.
 *
 * Every presentation, verdict and fetched document is kept whole in the admission, and the
 * evidence hash in both grants is their hash.
 */

const now = () => new Date().toISOString();
const nowSec = () => Math.floor(Date.now() / 1000);

type Data = {
  officerRequest?: VerifierRequest;
  officerUrl?: string;
  officer?: Received & { receivedAt: string };
  walletRequest?: VerifierRequest;
  walletUrl?: string;
  wallet?: Received & { receivedAt: string };
  corporateIdentity?: unknown;
  assessment?: Assessment;
  decision?: { by: string; at: string; outcome: "approved" | "declined" };
  written?: unknown;
  error?: string;
};

const dataOf = (a: Admission) => a.data as Data;

async function newRequest(origin: string, step: Step) {
  const c = protocolConfig(origin);
  const request = signedRequest(c, step, nowSec());
  const url = await lodge(c, request);
  return { request, url };
}

export async function startAdmission(r: Registrant, origin: string): Promise<Admission> {
  const { request, url } = await newRequest(origin, "officer");
  const a: Admission = {
    id: `adm_${randomBytes(9).toString("base64url")}`,
    registrantId: r.id,
    status: "awaiting-officer",
    createdAt: now(),
    officerRequestId: request.requestId,
    walletRequestId: null,
    data: { officerRequest: request, officerUrl: url } satisfies Data,
  };
  await getStore().putAdmission(a);
  await getStore().audit({ at: now(), actor: r.email, action: "started a pool admission", subject: a.id });
  return a;
}

/** A new request for whichever step is waiting, when the previous one has expired unanswered. */
export async function renewRequest(a: Admission, origin: string): Promise<void> {
  const step: Step | null = a.status === "awaiting-officer" ? "officer" : a.status === "awaiting-wallet" ? "wallet" : null;
  if (!step) return;
  const { request, url } = await newRequest(origin, step);
  const data: Data = step === "officer" ? { ...dataOf(a), officerRequest: request, officerUrl: url } : { ...dataOf(a), walletRequest: request, walletUrl: url };
  await getStore().updateAdmission(
    { ...a, officerRequestId: step === "officer" ? request.requestId : a.officerRequestId, walletRequestId: step === "wallet" ? request.requestId : a.walletRequestId, data },
    a.status,
  );
}

/**
 * A presentation posted by a holder wallet. Returns the verdict for the wallet to show, or null
 * when the presentation answers no request this site signed.
 */
export async function receivePresentation(body: unknown, origin: string): Promise<Received["verdict"] | null> {
  const presentation = extract(body);
  const requestId = presentation?.verifierRequest?.requestId;
  if (!presentation || typeof requestId !== "string") return null;

  const store = getStore();
  const a = await store.admissionByRequest(requestId);
  if (!a) return null;
  const d = dataOf(a);
  const step: Step | null =
    a.status === "awaiting-officer" && a.officerRequestId === requestId ? "officer" : a.status === "awaiting-wallet" && a.walletRequestId === requestId ? "wallet" : null;
  if (!step) return null;
  // The embedded request must be exactly the one this site signed: same bytes, same challenge.
  const signed = step === "officer" ? d.officerRequest : d.walletRequest;
  if (!signed || canonicalString(presentation.verifierRequest) !== canonicalString(signed)) return null;
  if (presentation.challenge?.toLowerCase() !== signed.challenge.toLowerCase()) return null;

  const c = protocolConfig(origin);
  const verdict = await verdictFor(c, presentation);
  const got = { presentation, verdict, receivedAt: now() };

  if (step === "officer") {
    if (verdict.decision !== "GRANT") {
      await store.updateAdmission({ ...a, status: "refused", data: { ...d, officer: got, error: `officer: ${verdict.reason}` } }, a.status);
      return verdict;
    }
    const next = await newRequest(origin, "wallet");
    await store.updateAdmission(
      { ...a, status: "awaiting-wallet", walletRequestId: next.request.requestId, data: { ...d, officer: got, walletRequest: next.request, walletUrl: next.url } },
      a.status,
    );
    return verdict;
  }

  // The wallet: fetch the corporate identity the officer acts for, and assess the three.
  const officer = d.officer!;
  const corporationDid = String(officer.presentation.disclosed.find((x) => x.key === "corporationDid")?.value ?? "");
  let data: Data = { ...d, wallet: got };
  let status: Admission["status"];
  try {
    const doc = await corporateIdentity(c, corporationDid);
    const assessment = assess(c, officer, got, doc, loadManifest().chainId, nowSec());
    data = { ...data, corporateIdentity: doc, assessment };
    status = assessment.ok ? "ready" : "refused";
  } catch (e) {
    data = { ...data, error: (e as Error).message };
    status = "refused";
  }
  if (await store.updateAdmission({ ...a, status, data }, a.status)) {
    await store.audit({ at: now(), actor: "holder wallet", action: status === "ready" ? "admission ready for approval" : "admission refused", subject: a.id });
    if (status === "ready") await notifyOperators(a.id, origin);
  }
  return verdict;
}

export async function decideAdmission(id: string, outcome: "approve" | "decline", operator: Registrant): Promise<void> {
  if (!isOperator(operator.email)) throw new Error("Not permitted.");
  const store = getStore();
  const a = await store.admissionById(id);
  if (!a || a.status !== "ready") throw new Error("That admission is not awaiting a decision.");
  const d = dataOf(a);
  const decision = { by: operator.email, at: now(), outcome: outcome === "approve" ? ("approved" as const) : ("declined" as const) };
  if (outcome === "decline") {
    await store.updateAdmission({ ...a, status: "declined", data: { ...d, decision } }, "ready");
    await store.audit({ at: now(), actor: operator.email, action: "declined a pool admission", subject: a.id });
    return;
  }
  // Claimed before anything is sent, so two approvals cannot both write.
  if (!(await store.updateAdmission({ ...a, status: "failed", data: { ...d, decision, error: "writing" } }, "ready"))) {
    throw new Error("That admission was decided already.");
  }
  const assessment = d.assessment;
  if (!assessment?.ok) throw new Error("That admission has no grants to write.");
  try {
    const written = await writeGrants(protocolConfig("").issuerDid, assessment.attestation, assessment.registry);
    await store.updateAdmission({ ...a, status: "admitted", data: { ...d, decision, written } }, "failed");
    await store.audit({ at: now(), actor: operator.email, action: `admitted ${assessment.summary.wallet} to the pool`, subject: a.id });
  } catch (e) {
    await store.updateAdmission({ ...a, status: "failed", data: { ...d, decision, error: (e as Error).message } }, "failed");
    await store.audit({ at: now(), actor: operator.email, action: "pool admission failed on-chain", subject: a.id });
    throw e;
  }
}

async function notifyOperators(id: string, origin: string) {
  await Promise.allSettled(emailList(process.env.OPERATOR_EMAILS).map((to) => sendMail(to, "Pool admission awaiting approval", `Review: ${origin}/operator#admissions\n\nAdmission ${id}\n`)));
}

function extract(body: unknown): Presentation | null {
  if (!body || typeof body !== "object") return null;
  const o = body as Record<string, unknown>;
  const p = (o.presentation && typeof o.presentation === "object" ? o.presentation : o) as Presentation;
  return p && typeof p === "object" && p.header && Array.isArray(p.disclosed) ? p : null;
}
