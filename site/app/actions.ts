"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { confirm, currentOperator, currentRegistrant, decide, register, requestSignIn, signOut } from "@/lib/access";
import { decideAdmission, renewRequest, startAdmission } from "@/lib/admission/service";
import { getStore } from "@/lib/store";
import { MailUnavailable } from "@/lib/mail";
import { siteOrigin } from "@/lib/origin";

export type FormState = { sent?: boolean; error?: string };

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
  await startAdmission(who, await siteOrigin());
  revalidatePath("/admit");
}

export async function renewAdmissionAction(f: FormData) {
  const who = await currentRegistrant();
  if (!who) redirect("/");
  const a = await getStore().admissionById(field(f, "id"));
  if (a && a.registrantId === who.id) await renewRequest(a, await siteOrigin());
  revalidatePath("/admit");
}

export async function decideAdmissionAction(f: FormData) {
  const op = await currentOperator();
  if (!op) throw new Error("Not permitted.");
  const d = field(f, "decision");
  if (d !== "approve" && d !== "decline") throw new Error("Unknown decision.");
  try {
    await decideAdmission(field(f, "id"), d, op);
  } finally {
    revalidatePath("/operator");
  }
}
