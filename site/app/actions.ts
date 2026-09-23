"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { confirm, decide, register, requestSignIn, signOut } from "@/lib/access";
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
