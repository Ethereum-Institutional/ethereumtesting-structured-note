"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { confirm, currentOperator, currentRegistrant, decide, register, requestSignIn, signOut } from "@/lib/access";
import {
  admitCustodied,
  advanceAdmission,
  offboardAdmission,
  revokeAtBank,
  cancelAdmission,
  finishCustodied,
  decideAdmission,
  renewRequest,
  renewSelfCustodyChallenge,
  requestSelfCustody,
  startWalletBinding,
  reviewSelfCustody,
  startAdmission,
  submitSelfCustodySignature,
} from "@/lib/admission/service";
import { getStore } from "@/lib/store";
import { addClient, rescreenClient } from "@/lib/admission/clients";
import { MailUnavailable } from "@/lib/mail";
import { siteOrigin } from "@/lib/origin";

export type FormState = { sent?: boolean; error?: string };

/**
 * An admission step that fails has already recorded why in the admission itself, where the page
 * shows it. The failure is logged and the page re-rendered, rather than shown as a server error.
 */
async function recorded(run: () => Promise<unknown>, path: string) {
  try {
    await run();
  } catch (e) {
    console.error(e);
  } finally {
    revalidatePath(path);
  }
}

const field = (f: FormData, k: string) => String(f.get(k) ?? "");

async function guarded(run: (origin: string) => Promise<{ ok: boolean; error?: string }>): Promise<FormState> {
  try {
    const r = await run(await siteOrigin());
    return r.ok ? { sent: true } : { error: r.error };
  } catch (e) {
    console.error(e);
    if (e instanceof MailUnavailable) return { error: "Email delivery is unavailable. Please try again later." };
    return { error: "Something went wrong. Please try again later." };
  }
}

export async function registerAction(_: FormState, f: FormData): Promise<FormState> {
  return guarded((origin) =>
    register({ email: field(f, "email"), name: field(f, "name"), organisation: field(f, "organisation") }, origin),
  );
}

export async function signInAction(_: FormState, f: FormData): Promise<FormState> {
  return guarded((origin) => requestSignIn(field(f, "email"), origin));
}

export async function confirmAction(f: FormData) {
  const outcome = await confirm(field(f, "token"), await siteOrigin());
  redirect(outcome === "signed-in" ? "/" : outcome === "pending" ? "/pending" : "/access?invalid=1");
}

export async function signOutAction() {
  await signOut();
  redirect("/");
}

export async function decideAction(f: FormData) {
  const d = field(f, "decision");
  if (d !== "approve" && d !== "revoke") throw new Error("Unknown decision.");
  await decide(field(f, "id"), d, await siteOrigin());
  revalidatePath("/operator");
}

export async function startAdmissionAction() {
  const who = await currentRegistrant();
  if (!who) redirect("/");
  const origin = await siteOrigin();
  await recorded(() => startAdmission(who, origin), "/onboard");
}

export async function renewAdmissionAction(f: FormData) {
  const who = await currentRegistrant();
  if (!who) redirect("/");
  const a = await getStore().admissionById(field(f, "id"));
  const origin = await siteOrigin();
  if (a && a.registrantId === who.id) await recorded(() => renewRequest(a, origin), "/onboard");
}

/** Moves a waiting admission on once its credentials are anchored (ADR 0060); for staff or the admission's own client. */
export async function advanceAdmissionAction(id: string) {
  const who = await currentRegistrant();
  if (!who) return;
  const a = await getStore().admissionById(id);
  if (!a || (a.registrantId !== who.id && !(await currentOperator()))) return;
  await recorded(() => advanceAdmission(id), a.registrantId === who.id ? "/onboard" : "/operator");
}

export async function cancelAdmissionAction(f: FormData) {
  const who = await currentRegistrant();
  if (!who) redirect("/");
  await recorded(() => cancelAdmission(who, field(f, "id")), "/onboard");
}

export async function decideAdmissionAction(f: FormData) {
  const op = await currentOperator();
  if (!op) throw new Error("Not permitted.");
  const d = field(f, "decision");
  await recorded(async () => {
    if (d !== "approve" && d !== "decline") throw new Error(`Unknown decision: ${d || "none"}.`);
    await decideAdmission(field(f, "id"), d, op);
  }, "/operator");
}

export async function admitCustodiedAction(f: FormData) {
  const op = await currentOperator();
  if (!op) throw new Error("Not permitted.");
  await recorded(
    () =>
      admitCustodied(op, {
        kycReference: field(f, "kycReference").trim(),
        instructionRef: field(f, "instructionRef").trim(),
        clientRef: field(f, "clientRef").trim(),
      }),
    "/operator",
  );
}

/** Adds a corporate client; the bank issues its corporate identity from what staff enter (ADR 0066). */
export async function addClientAction(_prev: { ok?: string; error?: string }, f: FormData): Promise<{ ok?: string; error?: string }> {
  const op = await currentOperator();
  if (!op) return { error: "Not permitted." };
  const get = (k: string) => field(f, k).trim();
  try {
    const c = await addClient(op, {
      kycReference: get("kycReference"),
      subjectDid: get("subjectDid"),
      legalName: get("legalName"),
      legalForm: get("legalForm"),
      registrationNumber: get("registrationNumber"),
      jurisdiction: get("jurisdiction"),
      incorporationDate: get("incorporationDate"),
      status: get("status"),
      investorClass: get("investorClass"),
      ceoOfficerDid: get("ceoOfficerDid"),
      cooOfficerDid: get("cooOfficerDid"),
      cfoOfficerDid: get("cfoOfficerDid"),
    });
    return { ok: `Added ${c.claims.legalName} (${c.kycReference}). The bank issued its corporate identity; it is anchored within about a minute.` };
  } catch (e) {
    console.error(e);
    return { error: (e as Error).message };
  } finally {
    revalidatePath("/operator");
  }
}

export async function rescreenClientAction(f: FormData) {
  const op = await currentOperator();
  if (!op) throw new Error("Not permitted.");
  await recorded(() => rescreenClient(op, field(f, "id")), "/operator");
}

export async function offboardAction(f: FormData) {
  const op = await currentOperator();
  if (!op) throw new Error("Not permitted.");
  await recorded(() => offboardAdmission(op, field(f, "id"), field(f, "reason")), "/operator");
}

export async function revokeAtBankAction(f: FormData) {
  const op = await currentOperator();
  if (!op) throw new Error("Not permitted.");
  const which = field(f, "which") === "corporate" ? "corporate" : "wallet";
  await recorded(
    () => revokeAtBank(op, field(f, "id"), which, field(f, "reason"), which === "corporate" ? Number(field(f, "affected")) : undefined),
    "/operator",
  );
}

export async function finishCustodiedAction(f: FormData) {
  const op = await currentOperator();
  if (!op) throw new Error("Not permitted.");
  await recorded(() => finishCustodied(op, field(f, "id")), "/operator");
}

export async function reviewSelfCustodyAction(f: FormData) {
  const op = await currentOperator();
  if (!op) throw new Error("Not permitted.");
  const d = field(f, "decision");
  await recorded(async () => {
    if (d !== "approve" && d !== "decline") throw new Error(`Unknown decision: ${d || "none"}.`);
    await reviewSelfCustody(op, field(f, "id"), d, d === "approve" ? field(f, "kycReference").trim() : undefined);
  }, "/operator");
}

export async function requestSelfCustodyAction(f: FormData) {
  const who = await currentRegistrant();
  if (!who) redirect("/");
  await recorded(() => requestSelfCustody(who), "/onboard");
}

export async function bindWalletAction(f: FormData) {
  const who = await currentRegistrant();
  if (!who) redirect("/");
  const type = field(f, "addressType") === "smart_contract" ? "smart_contract" : "eoa";
  await recorded(() => startWalletBinding(who, field(f, "id"), { walletAddress: field(f, "walletAddress").trim(), addressType: type }), "/onboard");
}

export async function submitSignatureAction(f: FormData) {
  const who = await currentRegistrant();
  if (!who) redirect("/");
  await recorded(() => submitSelfCustodySignature(who, field(f, "id"), field(f, "signature").trim() as `0x${string}`), "/onboard");
}

export async function renewChallengeAction(f: FormData) {
  const who = await currentRegistrant();
  if (!who) redirect("/");
  await recorded(() => renewSelfCustodyChallenge(who, field(f, "id")), "/onboard");
}
