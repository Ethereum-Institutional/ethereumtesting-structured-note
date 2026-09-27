"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { confirm, currentOperator, currentRegistrant, decide, register, requestSignIn, signOut } from "@/lib/access";
import {
  admitCustodied,
  cancelAdmission,
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
  await recorded(() => startAdmission(who, origin), "/admit");
}

export async function renewAdmissionAction(f: FormData) {
  const who = await currentRegistrant();
  if (!who) redirect("/");
  const a = await getStore().admissionById(field(f, "id"));
  const origin = await siteOrigin();
  if (a && a.registrantId === who.id) await recorded(() => renewRequest(a, origin), "/admit");
}

export async function cancelAdmissionAction(f: FormData) {
  const who = await currentRegistrant();
  if (!who) redirect("/");
  await recorded(() => cancelAdmission(who, field(f, "id")), "/admit");
}

export async function decideAdmissionAction(f: FormData) {
  const op = await currentOperator();
  if (!op) throw new Error("Not permitted.");
  const d = field(f, "decision");
  if (d !== "approve" && d !== "decline") throw new Error("Unknown decision.");
  await recorded(() => decideAdmission(field(f, "id"), d, op), "/operator");
}

/** The bank's statement of a client's details, from its own file (ADR 0054). */
function bankRecord(f: FormData) {
  const screened = field(f, "screenedOn");
  return {
    legalName: field(f, "legalName").trim(),
    kycReference: field(f, "kycReference").trim(),
    jurisdiction: field(f, "jurisdiction").trim().toUpperCase(),
    status: field(f, "status") || "active",
    screenedAt: screened ? Math.floor(Date.parse(`${screened}T00:00:00Z`) / 1000) : Math.floor(Date.now() / 1000),
    ...(field(f, "investorClass") ? { investorClass: field(f, "investorClass") } : {}),
  };
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
        record: bankRecord(f),
      }),
    "/operator",
  );
}

export async function reviewSelfCustodyAction(f: FormData) {
  const op = await currentOperator();
  if (!op) throw new Error("Not permitted.");
  const d = field(f, "decision");
  if (d !== "approve" && d !== "decline") throw new Error("Unknown decision.");
  await recorded(() => reviewSelfCustody(op, field(f, "id"), d, d === "approve" ? bankRecord(f) : undefined), "/operator");
}

export async function requestSelfCustodyAction(f: FormData) {
  const who = await currentRegistrant();
  if (!who) redirect("/");
  await recorded(() => requestSelfCustody(who), "/admit");
}

export async function bindWalletAction(f: FormData) {
  const who = await currentRegistrant();
  if (!who) redirect("/");
  const type = field(f, "addressType") === "smart_contract" ? "smart_contract" : "eoa";
  await recorded(() => startWalletBinding(who, field(f, "id"), { walletAddress: field(f, "walletAddress").trim(), addressType: type }), "/admit");
}

export async function submitSignatureAction(f: FormData) {
  const who = await currentRegistrant();
  if (!who) redirect("/");
  await recorded(() => submitSelfCustodySignature(who, field(f, "id"), field(f, "signature").trim() as `0x${string}`), "/admit");
}

export async function renewChallengeAction(f: FormData) {
  const who = await currentRegistrant();
  if (!who) redirect("/");
  await recorded(() => renewSelfCustodyChallenge(who, field(f, "id")), "/admit");
}
