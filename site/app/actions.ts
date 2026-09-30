"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { confirm, currentOperator, currentRegistrant, decide, register, requestSignIn, signOut } from "@/lib/access";
import {
  admitCustodied,
  advanceAdmission,
  bindNewWallet,
  completeOfficerWalletBinding,
  startOfficerWalletBinding,
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
      admitCustodied(op, { kycReference: field(f, "kycReference").trim() }),
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
    return { ok: `Added ${c.claims.legalName} as ${c.kycReference}. The bank issued its corporate identity; it is anchored within about a minute.` };
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

/**
 * The browser wallet's two calls (ADR 0068): the bank's message for the connected address, then the
 * signature. Each returns its outcome to the page, rather than failing into a server log.
 */
export async function browserWalletStartAction(id: string, address: string): Promise<{ typedData?: Record<string, unknown>; error?: string }> {
  const who = await currentRegistrant();
  if (!who) return { error: "Sign in again." };
  try {
    const a = await getStore().admissionById(id);
    if (a?.route === "holder-wallet") return { typedData: await startOfficerWalletBinding(who, id, address) };
    await startWalletBinding(who, id, { walletAddress: address, addressType: "eoa" });
    const bound = await getStore().admissionById(id);
    return { typedData: (bound?.data as Record<string, any>)?.challenge?.typedData };
  } catch (e) {
    console.error(e);
    return { error: (e as Error).message };
  }
}

export async function browserWalletFinishAction(id: string, signature: string): Promise<{ error?: string }> {
  const who = await currentRegistrant();
  if (!who) return { error: "Sign in again." };
  try {
    const a = await getStore().admissionById(id);
    if (a?.route === "holder-wallet") await completeOfficerWalletBinding(who, id, signature as `0x${string}`, await siteOrigin());
    else await submitSelfCustodySignature(who, id, signature as `0x${string}`);
    return {};
  } catch (e) {
    console.error(e);
    return { error: (e as Error).message };
  } finally {
    revalidatePath("/onboard");
  }
}

/** An onboarded client binds a new wallet under its confirmed KYB (ADR 0069). */
export async function bindNewWalletAction() {
  const who = await currentRegistrant();
  if (!who) redirect("/");
  await recorded(() => bindNewWallet(who), "/onboard");
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

// ---------------------------------------------------------------------------------------------
// Conversion in the pool, and the bank's credit of the deposit (ADR 0070)
// ---------------------------------------------------------------------------------------------

function units(amount: string, decimals: number): bigint {
  const s = amount.trim();
  if (!/^\d+(\.\d+)?$/.test(s)) throw new Error("Enter an amount such as 10 or 10.50.");
  const [whole, frac = ""] = s.split(".");
  if (frac.length > decimals) throw new Error(`At most ${decimals} decimal places.`);
  return BigInt(whole) * 10n ** BigInt(decimals) + BigInt((frac + "0".repeat(decimals)).slice(0, decimals) || "0");
}
const human = (v: bigint, decimals: number) => {
  const s = v.toString().padStart(decimals + 1, "0");
  return decimals ? `${s.slice(0, -decimals)}.${s.slice(-decimals)}` : s;
};
const asDirection = (v: string) => (v === "into-payment" ? "into-payment" : "into-deposit") as import("@/lib/pool/convert").Direction;

export type QuoteView = { error?: string; paid?: string; received?: string; amountIn?: string; amountOut?: string; minimumOut?: string };

export async function quoteAction(direction: string, amount: string): Promise<QuoteView> {
  const who = await currentRegistrant();
  if (!who) return { error: "Sign in again." };
  try {
    const { quote, tokens } = await import("@/lib/pool/convert");
    const t = tokens();
    const dir = asDirection(direction);
    const q = await quote(dir, units(amount, dir === "into-deposit" ? t.payment.decimals : t.deposit.decimals));
    return { paid: q.paid, received: q.received, amountIn: human(q.amountIn, q.paidDecimals), amountOut: human(q.amountOut, q.receivedDecimals), minimumOut: human(q.minimumOut, q.receivedDecimals) };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

/** The client's own onboarded wallet, and only that one, converts from the Onboard page. */
async function ownWallet(who: { id: string }): Promise<string | null> {
  const mine = await getStore().admissionsFor(who.id);
  const admitted = mine.find((x) => x.status === "admitted" && x.route !== "custodied");
  return (admitted?.data as Record<string, any>)?.assessment?.summary?.wallet ?? null;
}

export async function prepareConversionAction(
  direction: string,
  amount: string,
  address: string,
): Promise<{ error?: string; approvals?: Array<{ to: string; data: string; label: string }>; swap?: { to: string; data: string }; quote?: QuoteView }> {
  const who = await currentRegistrant();
  if (!who) return { error: "Sign in again." };
  try {
    const wallet = await ownWallet(who);
    if (!wallet) return { error: "Only an onboarded wallet can convert." };
    if (wallet.toLowerCase() !== address.toLowerCase()) return { error: `The wallet connected is ${address}; switch MetaMask to your onboarded wallet, ${wallet}.` };
    const c = await import("@/lib/pool/convert");
    const t = c.tokens();
    const dir = asDirection(direction);
    const amountIn = units(amount, dir === "into-deposit" ? t.payment.decimals : t.deposit.decimals);
    const have = await c.balances(wallet as `0x${string}`);
    if ((dir === "into-deposit" ? have.payment : have.deposit) < amountIn) return { error: "The wallet does not hold that much." };
    const nowSec = Math.floor(Date.now() / 1000);
    const q = await c.quote(dir, amountIn);
    const approvals = await c.approvalsNeeded(wallet as `0x${string}`, dir, amountIn, nowSec);
    return {
      approvals,
      swap: c.swapCall(dir, amountIn, q.minimumOut, nowSec),
      quote: { paid: q.paid, received: q.received, amountIn: human(q.amountIn, q.paidDecimals), amountOut: human(q.amountOut, q.receivedDecimals), minimumOut: human(q.minimumOut, q.receivedDecimals) },
    };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export async function conversionDoneAction(tx: string, summary: string) {
  const who = await currentRegistrant();
  if (!who) return;
  await getStore().audit({ at: new Date().toISOString(), actor: who.email, action: `converted in the pool: ${summary} (${tx})`, subject: who.id });
  revalidatePath("/onboard");
}

/** Staff convert for a custody account; the custodian's key signs through the account. */
export async function custodyConvertAction(f: FormData) {
  const op = await currentOperator();
  if (!op) throw new Error("Not permitted.");
  await recorded(async () => {
    const store = getStore();
    const a = await store.admissionById(field(f, "id"));
    if (!a || a.route !== "custodied" || a.status !== "admitted") throw new Error("Only an admitted custody account converts here.");
    const c = await import("@/lib/pool/convert");
    const t = c.tokens();
    const dir = asDirection(field(f, "direction"));
    const account = (a.data as Record<string, any>).assessment.summary.wallet as `0x${string}`;
    const amountIn = units(field(f, "amount"), dir === "into-deposit" ? t.payment.decimals : t.deposit.decimals);
    const done = await c.convertForCustody(account, dir, amountIn);
    const summary = `${human(done.quote.amountIn, done.quote.paidDecimals)} ${done.quote.paid} into ${done.quote.received} (at least ${human(done.quote.minimumOut, done.quote.receivedDecimals)})`;
    const latest = (await store.admissionById(a.id))!;
    const d = latest.data as Record<string, any>;
    await store.updateAdmission({ ...latest, data: { ...d, conversions: [...(d.conversions ?? []), { at: new Date().toISOString(), by: op.email, tx: done.tx, summary }] } }, latest.status);
    await store.audit({ at: new Date().toISOString(), actor: op.email, action: `converted for custody account ${account}: ${summary}`, subject: a.id });
  }, "/operator");
}

/** Staff credit the deposit to an onboarded account: the Deposit Agent, through the gateway. */
export async function creditDepositAction(f: FormData) {
  const op = await currentOperator();
  if (!op) throw new Error("Not permitted.");
  await recorded(async () => {
    const store = getStore();
    const a = await store.admissionById(field(f, "id"));
    if (!a || a.status !== "admitted") throw new Error("Only an admitted account is credited.");
    const c = await import("@/lib/pool/convert");
    const t = c.tokens();
    const account = (a.data as Record<string, any>).assessment.summary.wallet as `0x${string}`;
    const amount = units(field(f, "amount"), t.deposit.decimals);
    const done = await c.creditDeposit(account, amount);
    const latest = (await store.admissionById(a.id))!;
    const d = latest.data as Record<string, any>;
    const entry = { at: new Date().toISOString(), by: op.email, tx: done.tx, bookingRef: done.bookingRef, amount: human(amount, t.deposit.decimals) };
    await store.updateAdmission({ ...latest, data: { ...d, credits: [...(d.credits ?? []), entry] } }, latest.status);
    await store.audit({ at: entry.at, actor: op.email, action: `credited ${entry.amount} ${t.deposit.symbol} to ${account}, booking ${done.bookingRef}`, subject: a.id });
  }, "/operator");
}
