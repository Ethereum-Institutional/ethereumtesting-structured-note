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
import { assessBankAdmission, type BankAdmissionInput, type BankRecord } from "./assess.ts";
import { bankConfig, completeWalletAttestation, corporateIdentityFor, startWalletAttestation, type WalletChallenge } from "./bank.ts";
import { custodyAccountFor, openCustodyAccount, poolAllows, readyToTrade, signAsCustodyAccount } from "./custody.ts";
import { policyConfig } from "./protocol.ts";
import type { Address, Hex } from "viem";


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
  let request: VerifierRequest, url: string;
  try {
    ({ request, url } = await newRequest(origin, "officer"));
  } catch (e) {
    // Recorded, so the participant sees why rather than a server error.
    const failed: Admission = {
      id: `adm_${randomBytes(9).toString("base64url")}`,
      registrantId: r.id,
      route: "holder-wallet",
      status: "failed",
      createdAt: now(),
      officerRequestId: null,
      walletRequestId: null,
      data: { error: (e as Error).message },
    };
    await getStore().putAdmission(failed);
    throw e;
  }
  const a: Admission = {
    id: `adm_${randomBytes(9).toString("base64url")}`,
    registrantId: r.id,
    route: "holder-wallet",
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

// ---------------------------------------------------------------------------------------------
// The bank's routes (ADR 0054)
// ---------------------------------------------------------------------------------------------


const PURPOSE = "Admission to the conversion pool";

/**
 * Route 1, custodied: the bank's staff admit a client on its instruction. The custodian opens a
 * custody account; the account signs the wallet-control message; the bank mints the wallet
 * credential; both grants are written and the account is made ready to trade. One action.
 */
export async function admitCustodied(
  staff: Registrant,
  input: { kycReference: string; instructionRef: string; clientRef: string; record: Omit<BankRecord, "kycReference"> },
): Promise<Admission> {
  if (!isOperator(staff.email)) throw new Error("Not permitted.");
  const store = getStore();
  const policy = policyConfig();
  const bank = bankConfig();
  const chainId = loadManifest().chainId;
  const record: BankRecord = { ...input.record, kycReference: input.kycReference };
  const a: Admission = {
    id: `adm_${randomBytes(9).toString("base64url")}`,
    registrantId: staff.id,
    route: "custodied",
    status: "failed",
    createdAt: now(),
    officerRequestId: null,
    walletRequestId: null,
    data: { record, instructionRef: input.instructionRef, clientRef: input.clientRef, reviewedBy: staff.email, error: "writing" },
  };
  await store.putAdmission(a);
  let progress = a.data as Record<string, unknown>; // what is kept if a later step fails
  try {
    const corporate = await corporateIdentityFor(bank, input.kycReference, policy.schemas.corporateIdentity, nowSec());
    const account = await openCustodyAccount(input.clientRef);
    const challenge = await startWalletAttestation(bank, corporate.subjectDid, `eip155:${chainId}`, account, PURPOSE);
    const signature = await signAsCustodyAccount(challenge.typedData);
    const wallet = await completeWalletAttestation(bank, challenge.challengeId, account, "smart_contract", signature);
    const admission: BankAdmissionInput = {
      route: "custodied",
      record,
      corporateIdentity: corporate,
      wallet: { credentialId: wallet.credentialId, address: account, addressType: "smart_contract", chain: `eip155:${chainId}` },
      instructionRef: input.instructionRef,
      reviewedBy: staff.email,
    };
    const assessment = assessBankAdmission(policy, admission, chainId, nowSec());
    const data = { ...a.data, admission, walletAttestation: { challenge, signature, wallet }, assessment };
    if (!assessment.ok) {
      await store.updateAdmission({ ...a, status: "refused", data: { ...data, error: undefined } }, "failed");
      return (await store.admissionById(a.id))!;
    }
    const written = await writeGrants(policy.issuerDid, assessment.attestation, assessment.registry);
    // The grants are on-chain: recorded before the approvals, so a failure there loses nothing and can be finished.
    progress = { ...data, written, account };
    await store.updateAdmission({ ...a, data: { ...progress, error: "setting trading approvals" } }, "failed");
    const readyTx = await readyToTrade(account);
    await store.updateAdmission({ ...a, status: "admitted", data: { ...data, written: { ...written, readyTx }, error: undefined } }, "failed");
    await store.audit({ at: now(), actor: staff.email, action: `admitted custody account ${account} for ${record.legalName}`, subject: a.id });
  } catch (e) {
    await store.updateAdmission({ ...a, data: { ...progress, error: (e as Error).message } }, "failed");
    throw e;
  }
  return (await store.admissionById(a.id))!;
}

/**
 * Finishes a custodied admission whose grants were written but whose trading approvals failed. The
 * account is re-derived from the custody reference and must be admitted by the pool gate now.
 */
export async function finishCustodied(staff: Registrant, id: string): Promise<void> {
  if (!isOperator(staff.email)) throw new Error("Not permitted.");
  const store = getStore();
  const a = await store.admissionById(id);
  const d = (a?.data ?? {}) as Record<string, any>;
  if (!a || a.route !== "custodied" || a.status !== "failed" || !d.clientRef) throw new Error("That admission has nothing to finish.");
  const account = await custodyAccountFor(d.clientRef);
  if (!(await poolAllows(account))) throw new Error(`the pool does not admit ${account}: admit the client again`);
  try {
    const readyTx = await readyToTrade(account);
    const written = { chainId: loadManifest().chainId, ...(d.written ?? {}), readyTx };
    await store.updateAdmission({ ...a, status: "admitted", data: { ...d, account, written, error: undefined } }, "failed");
    await store.audit({ at: now(), actor: staff.email, action: `set the trading approvals for custody account ${account}`, subject: a.id });
  } catch (e) {
    await store.updateAdmission({ ...a, data: { ...d, account, error: (e as Error).message } }, "failed");
    throw e;
  }
}

/** The steps a client may walk away from: everything before the grants are being written (ADR 0058). */
export const CANCELLABLE: readonly Admission["status"][] = [
  "awaiting-bank-review", "kyb-confirmed", "awaiting-signature", "awaiting-officer", "awaiting-wallet", "ready",
];

/**
 * The client cancels its own admission, on any route, so it can start again on another. The
 * update only lands if the admission is still where the client saw it: a presentation, review or
 * signature that arrives afterwards finds it cancelled and does nothing.
 */
export async function cancelAdmission(client: Registrant, id: string): Promise<void> {
  const store = getStore();
  const a = await store.admissionById(id);
  if (!a || a.registrantId !== client.id || !CANCELLABLE.includes(a.status)) throw new Error("That admission can no longer be cancelled.");
  const d = a.data as Record<string, any>;
  if (!(await store.updateAdmission({ ...a, status: "cancelled", data: { ...d, cancelledAt: now(), cancelledFrom: a.status } }, a.status))) {
    throw new Error("That admission changed while cancelling; look again.");
  }
  await store.audit({ at: now(), actor: client.email, action: `cancelled a ${a.route} admission at ${a.status}`, subject: a.id });
}

/**
 * Route 2, step 1: a signed-in client asks its bank to confirm its KYB (ADR 0056). No wallet yet,
 * and no reference either: the bank knows its own client (ADR 0057). The reference the bank
 * confirmed last time is carried forward for its staff to reuse.
 */
export async function requestSelfCustody(client: Registrant): Promise<Admission> {
  const previous = await getStore().latestAdmissionFor(client.id);
  const knownReference = previous?.route === "self-custody" ? (previous.data as Record<string, any>).record?.kycReference : undefined;
  const a: Admission = {
    id: `adm_${randomBytes(9).toString("base64url")}`,
    registrantId: client.id,
    route: "self-custody",
    status: "awaiting-bank-review",
    createdAt: now(),
    officerRequestId: null,
    walletRequestId: null,
    data: { request: { requestedBy: client.email, organisation: client.organisation, ...(knownReference ? { knownReference } : {}) } },
  };
  await getStore().putAdmission(a);
  await getStore().audit({ at: now(), actor: client.email, action: "asked the bank to confirm its KYB for a self-custody wallet", subject: a.id });
  return a;
}

/**
 * Route 2, step 2: the bank's staff confirm the request is from the client they know, choose that
 * client's reference, which finds its corporate identity, and state the client's details from their file. The client may then bind a
 * wallet, which needs no further review (ADR 0056).
 */
export async function reviewSelfCustody(
  staff: Registrant,
  id: string,
  outcome: "approve" | "decline",
  record?: BankRecord,
): Promise<void> {
  if (!isOperator(staff.email)) throw new Error("Not permitted.");
  const store = getStore();
  const a = await store.admissionById(id);
  if (!a || a.route !== "self-custody" || a.status !== "awaiting-bank-review") throw new Error("That request is not awaiting review.");
  const d = a.data as Record<string, any>;
  if (outcome === "decline") {
    await store.updateAdmission({ ...a, status: "declined", data: { ...d, reviewedBy: staff.email } }, a.status);
    await store.audit({ at: now(), actor: staff.email, action: "declined a self-custody request", subject: a.id });
    return;
  }
  if (!record?.kycReference) throw new Error("Choose the client's reference at the bank.");
  const policy = policyConfig();
  const bank = bankConfig();
  let corporate;
  try {
    corporate = await corporateIdentityFor(bank, record.kycReference, policy.schemas.corporateIdentity, nowSec());
  } catch (e) {
    await store.updateAdmission({ ...a, status: "refused", data: { ...d, reviewedBy: staff.email, error: (e as Error).message } }, a.status);
    throw e;
  }
  await store.updateAdmission(
    { ...a, status: "kyb-confirmed", data: { ...d, record, corporate, reviewedBy: staff.email, confirmedAt: now() } },
    a.status,
  );
  await store.audit({ at: now(), actor: staff.email, action: "confirmed a client's KYB for self-custody", subject: a.id });
}

/**
 * Route 2, step 3: the client names the wallet to bind. The bank issues its challenge now, while
 * the client is here to sign it; a challenge that lapses is simply issued again.
 */
export async function startWalletBinding(
  client: Registrant,
  id: string,
  wallet: { walletAddress: string; addressType: "eoa" | "smart_contract" },
): Promise<void> {
  const store = getStore();
  const a = await store.admissionById(id);
  if (!a || a.registrantId !== client.id || (a.status !== "kyb-confirmed" && a.status !== "awaiting-signature")) {
    throw new Error("Your KYB is not confirmed yet.");
  }
  if (!/^0x[0-9a-fA-F]{40}$/.test(wallet.walletAddress)) throw new Error("That is not a wallet address.");
  const d = a.data as Record<string, any>;
  const challenge = await startWalletAttestation(bankConfig(), d.corporate.subjectDid, `eip155:${loadManifest().chainId}`, wallet.walletAddress, PURPOSE);
  await store.updateAdmission(
    { ...a, status: "awaiting-signature", data: { ...d, request: { ...d.request, ...wallet }, challenge } },
    a.status,
  );
}

/** A fresh challenge, when the client did not sign the last one in time. */
export async function renewSelfCustodyChallenge(client: Registrant, id: string): Promise<void> {
  const store = getStore();
  const a = await store.admissionById(id);
  if (!a || a.registrantId !== client.id || a.status !== "awaiting-signature") return;
  const d = a.data as Record<string, any>;
  const challenge = await startWalletAttestation(bankConfig(), d.corporate.subjectDid, `eip155:${loadManifest().chainId}`, d.request.walletAddress, PURPOSE);
  await store.updateAdmission({ ...a, data: { ...d, challenge } }, a.status);
}

/** Route 2, step 3: the client's one signature. The bank mints the wallet credential; grants follow. */
export async function submitSelfCustodySignature(client: Registrant, id: string, signature: Hex): Promise<Admission> {
  const store = getStore();
  const a = await store.admissionById(id);
  if (!a || a.registrantId !== client.id || a.status !== "awaiting-signature") throw new Error("That admission is not awaiting a signature.");
  const d = a.data as Record<string, any>;
  const policy = policyConfig();
  const chainId = loadManifest().chainId;
  const challenge = d.challenge as WalletChallenge;
  const walletAddress = d.request.walletAddress as Address;
  if (!(await store.updateAdmission({ ...a, status: "failed", data: { ...d, error: "writing" } }, "awaiting-signature"))) {
    throw new Error("That signature was submitted already.");
  }
  try {
    const wallet = await completeWalletAttestation(bankConfig(), challenge.challengeId, walletAddress, d.request.addressType, signature);
    const admission: BankAdmissionInput = {
      route: "self-custody",
      record: d.record,
      corporateIdentity: d.corporate,
      wallet: { credentialId: wallet.credentialId, address: walletAddress, addressType: d.request.addressType, chain: `eip155:${chainId}` },
      instructionRef: a.id,
      reviewedBy: d.reviewedBy,
    };
    const assessment = assessBankAdmission(policy, admission, chainId, nowSec());
    const data = { ...d, admission, walletAttestation: { challenge, signature, wallet }, assessment, error: undefined };
    if (!assessment.ok) {
      await store.updateAdmission({ ...a, status: "refused", data }, "failed");
    } else {
      const written = await writeGrants(policy.issuerDid, assessment.attestation, assessment.registry);
      await store.updateAdmission({ ...a, status: "admitted", data: { ...data, written } }, "failed");
      await store.audit({ at: now(), actor: client.email, action: `admitted self-custody wallet ${walletAddress}`, subject: a.id });
    }
  } catch (e) {
    // The KYB is still confirmed; only this binding failed. The client can bind again at once.
    await store.updateAdmission({ ...a, status: "kyb-confirmed", data: { ...d, challenge: undefined, error: (e as Error).message } }, "failed");
    throw e;
  }
  return (await store.admissionById(a.id))!;
}
