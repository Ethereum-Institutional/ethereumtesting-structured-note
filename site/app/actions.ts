"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { confirm, currentRegistrant, currentStaff, decide, register, requestSignIn, resendConfirmation, signOut } from "@/lib/access";
import * as onboarding from "@/lib/identity/onboarding";
import { getStore } from "@/lib/store";
import { addClient, rescreenClient } from "@/lib/identity/clients";
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
    // Every page of a staff portal shares its layout: refresh them all (ADR 0089).
    revalidatePath(path, /^\/(agent|bank|onboarding|custodian)/.test(path) ? "layout" : "page");
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
  if (!(await currentStaff("bank"))) throw new Error("Not permitted.");
  await decide(field(f, "id"), d, await siteOrigin());
  revalidatePath("/bank", "layout");
}

/** Staff resend the confirmation link; whether the mail went is said on the row. */
export async function resendLinkAction(_prev: FormState, f: FormData): Promise<FormState> {
  if (!(await currentStaff("bank"))) return { error: "Not permitted." };
  try {
    await resendConfirmation(field(f, "id"), await siteOrigin());
    return { sent: true };
  } catch (e) {
    console.error(e);
    return { error: e instanceof MailUnavailable ? "Email delivery is unavailable: the link was not sent." : (e as Error).message };
  } finally {
    revalidatePath("/bank", "layout");
  }
}

// ---------------------------------------------------------------------------------------------
// Onboarding by role (ADR 0089)
// ---------------------------------------------------------------------------------------------

type Result = { ok?: string; error?: string };

/** A staff step that says how it went beside its button, the refusal included. */
async function staffStep(role: import("@/lib/operators").Role, path: string, run: (staff: import("@/lib/store").Registrant) => Promise<string | void>): Promise<Result> {
  const staff = await currentStaff(role);
  if (!staff) return { error: "Not permitted." };
  try {
    const ok = await run(staff);
    return { ok: ok || "Done." };
  } catch (e) {
    console.error(e);
    return { error: (e as Error).message };
  } finally {
    revalidatePath(path, "layout");
  }
}

// --- the client ---

export async function requestRouteAction(f: FormData) {
  const who = await currentRegistrant();
  if (!who) redirect("/");
  const route = field(f, "route") as (typeof onboarding.CLIENT_ROUTES)[number];
  await recorded(() => onboarding.requestRoute(who, route, field(f, "knownReference")), "/onboard");
}

export async function cancelOnboardingAction(f: FormData) {
  const who = await currentRegistrant();
  if (!who) redirect("/");
  await recorded(() => onboarding.cancel(who, field(f, "id")), "/onboard");
}

/** The browser wallet's two calls (ADR 0068): the message for the connected address, then the signature. */
export async function browserWalletStartAction(id: string, address: string): Promise<{ typedData?: Record<string, unknown>; error?: string }> {
  const who = await currentRegistrant();
  if (!who) return { error: "Sign in again." };
  try {
    const a = await getStore().admissionById(id);
    if (a?.route === "existing-identity") return { typedData: await onboarding.startExistingWallet(who, id, address) };
    return { typedData: await onboarding.startWallet(who, id, address) };
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
    if (a?.route === "existing-identity") await onboarding.completeExisting(who, id, signature as `0x${string}`);
    else await onboarding.completeWallet(who, id, signature as `0x${string}`);
    return {};
  } catch (e) {
    console.error(e);
    return { error: (e as Error).message };
  } finally {
    revalidatePath("/onboard");
  }
}

export async function requestNoteAction(_prev: Result, f: FormData): Promise<Result> {
  const who = await currentRegistrant();
  if (!who) return { error: "Sign in again." };
  try {
    await onboarding.requestNote(who, field(f, "id"), {
      notUsPerson: field(f, "notUsPerson") === "on",
      investorClass: field(f, "investorClass"),
      relyOnBankKyb: field(f, "relyOnBankKyb") === "on",
    });
    return { ok: "Asked. The onboarding agent decides." };
  } catch (e) {
    return { error: (e as Error).message };
  } finally {
    revalidatePath("/onboard", "layout");
  }
}

export async function bringIdentityAction(_prev: Result, f: FormData): Promise<Result> {
  const who = await currentRegistrant();
  if (!who) return { error: "Sign in again." };
  try {
    await onboarding.requestExisting(who, field(f, "identity").trim());
    return { ok: "Now connect the wallet to register against it, and sign." };
  } catch (e) {
    return { error: (e as Error).message };
  } finally {
    revalidatePath("/onboard", "layout");
  }
}

// --- the bank ---

/** Adds a corporate client to the bank's records (ADR 0089). */
export async function addClientAction(_prev: Result, f: FormData): Promise<Result> {
  return staffStep("bank", "/bank", async (staff) => {
    const get = (k: string) => field(f, k).trim();
    const c = await addClient(staff, {
      kycReference: get("kycReference"),
      legalName: get("legalName"),
      legalForm: get("legalForm"),
      registrationNumber: get("registrationNumber"),
      jurisdiction: get("jurisdiction"),
      incorporationDate: get("incorporationDate"),
      status: get("status"),
      investorClass: get("investorClass"),
    });
    return `Added ${String(c.claims.legalName)} as ${c.kycReference}.`;
  });
}

export async function rescreenClientAction(f: FormData) {
  const staff = await currentStaff("bank");
  if (!staff) throw new Error("Not permitted.");
  await recorded(() => rescreenClient(staff, field(f, "id")), "/bank");
}

export async function confirmRouteAction(_prev: Result, f: FormData): Promise<Result> {
  return staffStep("bank", "/bank", async (staff) => {
    const a = await onboarding.confirmRoute(staff, field(f, "id"), field(f, "kycReference"));
    return a.status === "onboarded" ? "Confirmed: the custody account is open and onboarded for the deposit." : "Confirmed.";
  });
}

export async function declineRouteAction(_prev: Result, f: FormData): Promise<Result> {
  return staffStep("bank", "/bank", (staff) => onboarding.decline(staff, field(f, "id"), field(f, "reason")));
}

export async function revokeDepositAction(_prev: Result, f: FormData): Promise<Result> {
  return staffStep("bank", "/bank", async (staff) => {
    await onboarding.revokeDeposit(staff, field(f, "id"), field(f, "reason"));
    return "Revoked: the wallet can no longer hold or receive the deposit.";
  });
}

export async function renewDepositAction(_prev: Result, f: FormData): Promise<Result> {
  return staffStep("bank", "/bank", async (staff) => {
    await onboarding.renewDeposit(staff, field(f, "id"));
    return "Renewed against the client's current record.";
  });
}

export async function offboardAction(_prev: Result, f: FormData): Promise<Result> {
  return staffStep("bank", "/bank", async (staff) => {
    await onboarding.offboard(staff, field(f, "id"), field(f, "reason"));
    return "Offboarded.";
  });
}

/** The bank credits its deposit to an onboarded wallet, through the gateway. */
export async function creditDepositAction(_prev: Result, f: FormData): Promise<Result> {
  return staffStep("bank", "/bank", async (staff) => {
    const store = getStore();
    const a = await store.admissionById(field(f, "id"));
    if (!a || a.status !== "onboarded") throw new Error("Only an onboarded wallet is credited.");
    const { creditDeposit, depositToken } = await import("@/lib/identity/deposit");
    const t = depositToken();
    const account = onboarding.walletOf(a);
    const amount = units(field(f, "amount"), t.decimals);
    const done = await creditDeposit(account, amount);
    const latest = (await store.admissionById(a.id))!;
    const d = latest.data as Record<string, any>;
    const entry = { at: new Date().toISOString(), by: staff.email, tx: done.tx, bookingRef: done.bookingRef, amount: human(amount, t.decimals) };
    await store.updateAdmission({ ...latest, data: { ...d, credits: [...(d.credits ?? []), entry] } }, latest.status);
    await store.audit({ at: entry.at, actor: staff.email, action: `credited ${entry.amount} ${t.symbol} to ${account}, booking ${done.bookingRef}`, subject: a.id });
    return `Credited ${entry.amount} ${t.symbol}, booking ${done.bookingRef}.`;
  });
}

// --- the bank's deposit (ADR 0092) ---

const depositAccount = (f: FormData) => {
  const a = field(f, "account").trim();
  if (!/^0x[0-9a-fA-F]{40}$/.test(a)) throw new Error("Choose the account.");
  return a as `0x${string}`;
};

export async function debitDepositAction(_prev: Result, f: FormData): Promise<Result> {
  return staffStep("bank", "/bank/deposit", async (staff) => {
    const { debitDeposit, depositToken } = await import("@/lib/identity/deposit");
    const t = depositToken();
    const account = depositAccount(f);
    const amount = units(field(f, "amount"), t.decimals);
    const done = await debitDeposit(account, amount);
    await getStore().audit({ at: new Date().toISOString(), actor: staff.email, action: `debited ${human(amount, t.decimals)} ${t.symbol} from ${account} to its account at the bank, booking ${done.bookingRef}`, subject: account });
    return `Debited ${human(amount, t.decimals)} ${t.symbol}, booking ${done.bookingRef}.`;
  });
}

export async function creditAccountAction(_prev: Result, f: FormData): Promise<Result> {
  return staffStep("bank", "/bank/deposit", async (staff) => {
    const { creditDeposit, depositToken } = await import("@/lib/identity/deposit");
    const t = depositToken();
    const account = depositAccount(f);
    const amount = units(field(f, "amount"), t.decimals);
    const done = await creditDeposit(account, amount);
    await getStore().audit({ at: new Date().toISOString(), actor: staff.email, action: `credited ${human(amount, t.decimals)} ${t.symbol} to ${account}, booking ${done.bookingRef}`, subject: account });
    return `Credited ${human(amount, t.decimals)} ${t.symbol}, booking ${done.bookingRef}.`;
  });
}

export async function holdDepositAction(_prev: Result, f: FormData): Promise<Result> {
  return staffStep("bank", "/bank/deposit", async (staff) => {
    const { holdDeposit, depositToken } = await import("@/lib/identity/deposit");
    const t = depositToken();
    const account = depositAccount(f);
    const reason = field(f, "reason").trim();
    if (!reason) throw new Error("Give the reason.");
    const amount = units(field(f, "amount") || "0", t.decimals);
    await holdDeposit(account, amount);
    await getStore().audit({ at: new Date().toISOString(), actor: staff.email, action: amount ? `held ${human(amount, t.decimals)} ${t.symbol} of ${account}: ${reason}` : `released the hold on ${account}: ${reason}`, subject: account });
    return amount ? `Held ${human(amount, t.decimals)} ${t.symbol}: it cannot move or be debited until released.` : "Released: the whole balance is free.";
  });
}

export async function pauseDepositAction(_prev: Result, f: FormData): Promise<Result> {
  return staffStep("bank", "/bank/deposit", async (staff) => {
    const { setPaused, depositToken } = await import("@/lib/identity/deposit");
    const pause = field(f, "pause") === "1";
    const reason = field(f, "reason").trim();
    if (!reason) throw new Error("Give the reason.");
    await setPaused(pause);
    await getStore().audit({ at: new Date().toISOString(), actor: staff.email, action: `${pause ? "paused" : "resumed"} the ${depositToken().symbol} deposit: ${reason}`, subject: "deposit" });
    return pause ? "Paused: no transfer, credit or debit moves until it resumes." : "Resumed.";
  });
}

export async function enforceDepositAction(_prev: Result, f: FormData): Promise<Result> {
  return staffStep("bank", "/bank/deposit", async (staff) => {
    const { enforce, depositToken } = await import("@/lib/identity/deposit");
    const t = depositToken();
    const from = depositAccount(f);
    const to = field(f, "to").trim();
    if (!/^0x[0-9a-fA-F]{40}$/.test(to)) throw new Error("Choose the receiving account.");
    const amount = units(field(f, "amount"), t.decimals);
    const reason = field(f, "reason");
    await enforce(from, to as `0x${string}`, amount, reason);
    await getStore().audit({ at: new Date().toISOString(), actor: staff.email, action: `moved ${human(amount, t.decimals)} ${t.symbol} from ${from} to ${to} by order: ${reason.trim()}`, subject: from });
    return `Moved ${human(amount, t.decimals)} ${t.symbol} by order, the reason recorded on-chain.`;
  });
}

// --- the custodians ---

export async function openAccountAction(_prev: Result, f: FormData): Promise<Result> {
  return staffStep("custodian", "/custodian", async (staff) => {
    const a = await onboarding.openForClient(staff, field(f, "id"), "third-party");
    return `Opened ${onboarding.walletOf(a)} and onboarded it for the deposit.`;
  });
}

// --- the onboarding agent ---

export async function decideNoteAction(_prev: Result, f: FormData): Promise<Result> {
  return staffStep("onboarding", "/onboarding", async (staff) => {
    const outcome = field(f, "decision") === "decline" ? "decline" : "approve";
    await onboarding.decideNote(staff, field(f, "id"), outcome, field(f, "reason"));
    return outcome === "approve" ? "Approved: the note claim is on the client's identity." : "Declined.";
  });
}

export async function revokeNoteAction(_prev: Result, f: FormData): Promise<Result> {
  return staffStep("onboarding", "/onboarding", async (staff) => {
    await onboarding.revokeNote(staff, field(f, "id"), field(f, "reason"));
    return "Revoked: the wallet can no longer receive the note.";
  });
}

export async function admitToPoolAction(_prev: Result, f: FormData): Promise<Result> {
  return staffStep("bank", "/bank/pool", async (staff) => {
    await onboarding.admitToPool(staff, field(f, "id"), field(f, "investorClass"));
    return "Admitted: the wallet may convert in the pool.";
  });
}

export async function revokePoolAction(_prev: Result, f: FormData): Promise<Result> {
  return staffStep("bank", "/bank/pool", async (staff) => {
    await onboarding.revokePool(staff, field(f, "id"), field(f, "reason"));
    return "Revoked: the wallet can no longer convert in the pool.";
  });
}

export async function acceptExistingAction(_prev: Result, f: FormData): Promise<Result> {
  return staffStep("onboarding", "/onboarding", async (staff) => {
    await onboarding.acceptExisting(staff, field(f, "id"));
    const a = await getStore().admissionById(field(f, "id"));
    return a?.status === "onboarded" ? "Registered: the note's registry verifies the identity." : "Refused: no issuer the note trusts vouches for it.";
  });
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
  const own = mine.find((x) => x.status === "onboarded" && x.route === "self-custody");
  return own ? onboarding.walletOf(own) : null;
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
    const standing = await (await import("@/lib/identity/onchain")).poolStanding(wallet as `0x${string}`);
    if (standing !== "admitted") return { error: `The pool refuses your wallet: ${standing ?? "there is no pool"}.` };
    const c = await import("@/lib/pool/convert");
    const t = c.tokens();
    const dir = asDirection(direction);
    const amountIn = units(amount, dir === "into-deposit" ? t.payment.decimals : t.deposit.decimals);
    const have = await c.balances(wallet as `0x${string}`);
    if ((dir === "into-deposit" ? have.payment : have.deposit) < amountIn) return { error: "The wallet does not hold that much." };
    const nowSec = await c.chainNow();
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

/** The bank's custody platform converts for a custody account it holds; its key signs through the account. */
export async function custodyConvertAction(_prev: Result, f: FormData): Promise<Result> {
  return staffStep("custodian", "/custodian", async (op) => {
    const store = getStore();
    const a = await store.admissionById(field(f, "id"));
    if (!a || a.route !== "bank-custody" || a.status !== "onboarded") throw new Error("Only an onboarded account in the bank's custody converts here.");
    const c = await import("@/lib/pool/convert");
    const { poolStanding } = await import("@/lib/identity/onchain");
    const account = onboarding.walletOf(a);
    const standing = await poolStanding(account);
    if (standing !== "admitted") throw new Error(`The pool refuses this account: ${standing ?? "there is no pool"}.`);
    const t = c.tokens();
    const dir = asDirection(field(f, "direction"));
    const amountIn = units(field(f, "amount"), dir === "into-deposit" ? t.payment.decimals : t.deposit.decimals);
    const done = await c.convertForCustody(account, dir, amountIn);
    const summary = `${human(done.quote.amountIn, done.quote.paidDecimals)} ${done.quote.paid} into ${done.quote.received} (at least ${human(done.quote.minimumOut, done.quote.receivedDecimals)})`;
    const latest = (await store.admissionById(a.id))!;
    const d = latest.data as Record<string, any>;
    await store.updateAdmission({ ...latest, data: { ...d, conversions: [...(d.conversions ?? []), { at: new Date().toISOString(), by: op.email, tx: done.tx, summary }] } }, latest.status);
    await store.audit({ at: new Date().toISOString(), actor: op.email, action: `converted for custody account ${account}: ${summary}`, subject: a.id });
    return `Converted ${summary}.`;
  });
}


// ---------------------------------------------------------------------------------------------
// Notes (ADRs 0072, 0073)
// ---------------------------------------------------------------------------------------------

export async function startNoteAction(f: FormData) {
  const op = await currentStaff("agent");
  if (!op) throw new Error("Not permitted.");
  await recorded(async () => {
    const { startNote, advanceIssuance } = await import("@/lib/notes/issue");
    const unit = field(f, "intervalUnit") as "minutes" | "hours" | "days" | "months";
    const n = await startNote(op, {
      scenario: field(f, "scenario"),
      observations: Number(field(f, "observations")),
      interval: { value: Number(field(f, "intervalValue")), unit },
      units: Number(field(f, "units")),
    });
    await advanceIssuance(n.id);
  }, "/agent/notes");
}

/** Moves a note's issuance on by a step; the Agent's Notes page calls it while a note is being issued. */
export async function advanceNoteAction(id: string) {
  const op = await currentStaff("agent");
  if (!op) return;
  const { advanceIssuance } = await import("@/lib/notes/issue");
  await recorded(() => advanceIssuance(id), "/agent/notes");
}





/** Staff place units with an account (S-08); the note's refusal, such as S-09's, comes back to the form. */
export async function placeUnitsAction(_prev: { ok?: string; error?: string }, f: FormData): Promise<{ ok?: string; error?: string }> {
  const op = await currentStaff("agent");
  if (!op) return { error: "Not permitted." };
  try {
    const place = await import("@/lib/notes/place");
    const count = Number(field(f, "units"));
    const p = await place.placeUnits(op, field(f, "noteId"), field(f, "admission"), count, units(field(f, "price"), 2));
    return {
      ok: p.status === "settled"
        ? `Settled: ${p.units} units against €${(Number(p.priceCents) / 100).toLocaleString("en-GB", { minimumFractionDigits: 2 })}, accepted by the custodian.`
        : `Offer ${p.id} made: the client accepts from its wallet on its Notes page, within 24 hours.`,
    };
  } catch (e) {
    console.error(e);
    return { error: (e as Error).message };
  } finally {
    revalidatePath("/agent", "layout");
  }
}

/** Staff withdraw an offer the site acts for: the Issuer's, or a custody account's (ADR 0081). */
export async function cancelOfferAction(_prev: { ok?: string; error?: string }, f: FormData) {
  return lifecycleStep(async (op) => {
    await (await import("@/lib/notes/place")).cancelOffer(op, field(f, "noteId"), field(f, "offerId"));
    return "Withdrawn; its lock is released.";
  });
}

const perUnit = (f: FormData) => units(field(f, "price"), 2);

/** Staff offer to buy units back from a holder (S-13). */
export async function buybackAction(_prev: { ok?: string; error?: string }, f: FormData) {
  return lifecycleStep(async (op) => {
    const o = await (await import("@/lib/notes/place")).offerBuyback(op, field(f, "noteId"), field(f, "admission"), Number(field(f, "units")), perUnit(f));
    return o.status === "settled" ? `Bought back ${o.units} units; they are in the Issuer's inventory.` : `Offer ${o.id} made: the holder accepts from its wallet, within 24 hours.`;
  });
}

/** Staff arrange a transfer between two accounts, or an open offer from one (ADR 0081). */
export async function arrangeTradeAction(_prev: { ok?: string; error?: string }, f: FormData) {
  return lifecycleStep(async (op) => {
    const buyer = field(f, "buyer");
    const r = await (await import("@/lib/notes/place")).arrangeTrade(op, field(f, "noteId"), {
      seller: field(f, "seller"),
      buyer: buyer === "open" ? null : buyer,
      units: Number(field(f, "units")),
      pricePerUnitCents: perUnit(f),
    });
    if (r.arranged) return `Arranged (${r.arranged.ref}): the seller offers from its wallet, on its Notes page.`;
    return r.offer?.status === "settled" ? `Settled: ${r.offer.units} units moved.` : `Offer ${r.offer?.id} made: the other side acts from its wallet.`;
  });
}

export async function withdrawArrangedAction(_prev: { ok?: string; error?: string }, f: FormData) {
  return lifecycleStep(async (op) => {
    await (await import("@/lib/notes/place")).withdrawArranged(op, field(f, "noteId"), field(f, "ref"));
    return "Withdrawn.";
  });
}

/** Staff take an open offer for a custody account. */
export async function takeForCustodyAction(_prev: { ok?: string; error?: string }, f: FormData) {
  return lifecycleStep(async (op) => {
    await (await import("@/lib/notes/place")).takeForCustody(op, field(f, "noteId"), field(f, "offerId"), field(f, "admission"));
    return "Taken: both legs settled.";
  });
}

/** Staff cancel units from the Issuer's inventory (S-14). */
export async function cancelInventoryAction(_prev: { ok?: string; error?: string }, f: FormData) {
  return lifecycleStep(async (op) => {
    const n = Number(field(f, "units"));
    await (await import("@/lib/notes/place")).cancelFromInventory(op, field(f, "noteId"), n);
    return `Cancelled ${n} units; the note's total is reduced.`;
  });
}

/** Anyone may release offers past their deadline; staff do it from the note's page. */
export async function releaseExpiredAction(_prev: { ok?: string; error?: string }, f: FormData) {
  return lifecycleStep(async () => {
    const n = await (await import("@/lib/notes/place")).releaseOpenOffers(field(f, "noteId"));
    return n ? `Released ${n} offer${n === 1 ? "" : "s"}.` : "No offer is past its deadline.";
  });
}

type WalletPlan = { txs?: Array<{ to: string; data: string; label: string }>; error?: string };

/** The transactions a client's wallet sends to make an offer: arranged by its bank, or its own. */
export async function prepareOfferAction(noteId: string, input: { arranged?: string; side?: string; units?: string; price?: string }, address: string): Promise<WalletPlan> {
  const who = await currentRegistrant();
  if (!who) return { error: "Sign in again." };
  try {
    return {
      txs: await (await import("@/lib/notes/place")).offerTxsFor(
        who,
        noteId,
        input.arranged
          ? { arranged: input.arranged }
          : { side: input.side === "buy" ? "buy" : "sell", units: Number(input.units), pricePerUnitCents: units(input.price ?? "", 2) },
        address,
      ),
    };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

/** The transaction a client's wallet sends to withdraw its offer, or decline one named to it. */
export async function prepareCancelAction(noteId: string, offerId: string, address: string): Promise<WalletPlan> {
  const who = await currentRegistrant();
  if (!who) return { error: "Sign in again." };
  try {
    return { txs: await (await import("@/lib/notes/place")).cancelTxFor(who, noteId, offerId, address) };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

/** After a client's wallet made or withdrew an offer: recorded, and the pages refreshed. */
export async function walletActedAction(noteId: string, arranged: string, tx: string): Promise<{ status?: string; error?: string }> {
  const who = await currentRegistrant();
  if (!who) return { error: "Sign in again." };
  try {
    await (await import("@/lib/notes/place")).walletActed(who, noteId, tx, arranged || undefined);
    return { status: "done" };
  } catch (e) {
    return { error: (e as Error).message };
  } finally {
    revalidatePath("/onboard", "layout");
    revalidatePath("/agent", "layout");
  }
}

/** The two transactions a client's wallet sends to accept an offer. */
export async function prepareAcceptanceAction(noteId: string, tradeId: string, address: string): Promise<{ txs?: Array<{ to: string; data: string; label: string }>; error?: string }> {
  const who = await currentRegistrant();
  if (!who) return { error: "Sign in again." };
  try {
    return { txs: await (await import("@/lib/notes/place")).acceptanceFor(who, noteId, tradeId, address) };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export async function acceptanceDoneAction(noteId: string, tradeId: string, tx: string): Promise<{ status?: string; error?: string }> {
  const who = await currentRegistrant();
  if (!who) return { error: "Sign in again." };
  try {
    const place = await import("@/lib/notes/place");
    const p = await place.refreshPlacement(noteId, tradeId, tx);
    if (p?.status === "settled") await getStore().audit({ at: new Date().toISOString(), actor: who.email, action: `accepted offer ${tradeId}: ${p.units} units settled`, subject: noteId });
    return { status: p?.status };
  } catch (e) {
    return { error: (e as Error).message };
  } finally {
    revalidatePath("/onboard", "layout");
  }
}

/** The lifecycle's steps (ADR 0078): each says what it did, or the contract's refusal. */
async function lifecycleStep(run: (op: NonNullable<Awaited<ReturnType<typeof currentRegistrant>>>) => Promise<string>): Promise<{ ok?: string; error?: string }> {
  const op = await currentStaff("agent");
  if (!op) return { error: "Not permitted." };
  try {
    return { ok: await run(op) };
  } catch (e) {
    console.error(e);
    return { error: (e as Error).message };
  } finally {
    revalidatePath("/agent", "layout");
    revalidatePath("/onboard", "layout");
  }
}

export async function determineAction(_prev: { ok?: string; error?: string }, f: FormData) {
  return lifecycleStep(async (op) => {
    const levels = f.getAll("level").map((v) => {
      const s = String(v).trim();
      if (!/^\d+$/.test(s)) throw new Error("Each Level is a whole number.");
      return BigInt(s);
    });
    const k = Number(field(f, "date"));
    await (await import("@/lib/notes/lifecycle")).determineDate(op, field(f, "noteId"), k, levels);
    return `Date ${k + 1} determined.`;
  });
}

export async function payEventAction(_prev: { ok?: string; error?: string }, f: FormData) {
  return lifecycleStep(async (op) => {
    const k = Number(field(f, "date"));
    const kind = field(f, "kind") === "redemption" ? "redemption" : "coupon";
    const txs = await (await import("@/lib/notes/lifecycle")).payEvent(op, field(f, "noteId"), k, kind);
    return `Paid, in ${txs.length} transaction${txs.length === 1 ? "" : "s"} from the servicing wallet.`;
  });
}

export async function claimHeldAction(_prev: { ok?: string; error?: string }, f: FormData) {
  return lifecycleStep(async (op) => {
    await (await import("@/lib/notes/lifecycle")).claimHeld(op, field(f, "noteId"), field(f, "id") as `0x${string}`, field(f, "holder") as `0x${string}`);
    return "Paid to the holder.";
  });
}

/** Staff top up a key from the best-funded one (ADR 0080). */
export async function topUpAction(_prev: { ok?: string; error?: string }, f: FormData) {
  return lifecycleStep(async (op) => {
    const { topUp, TOP_UP } = await import("@/lib/chain/keys");
    const { formatEther } = await import("viem");
    await topUp(op, field(f, "capacity"));
    return `Sent ${formatEther(TOP_UP)} ETH.`;
  });
}

// --- governance (ADR 0082) ---

export async function correctRegisterAction(_prev: { ok?: string; error?: string }, f: FormData) {
  return lifecycleStep(async (op) => {
    const units = Number(field(f, "units"));
    await (await import("@/lib/governance")).correctRegister(op, { from: field(f, "from") as `0x${string}`, to: field(f, "to") as `0x${string}`, units, reason: field(f, "reason") });
    return `Corrected: ${units} unit${units === 1 ? "" : "s"} moved, the reason recorded on-chain.`;
  });
}

export async function tier1WithdrawAction(_prev: { ok?: string; error?: string }, f: FormData) {
  return lifecycleStep(async (op) => {
    const w = field(f, "what");
    const what = w === "pool" || w === "restore-pool" || w === "unfreeze" ? w : "freeze";
    await (await import("@/lib/governance")).withdraw(op, { what, account: field(f, "account") as `0x${string}`, reason: field(f, "reason") });
    return {
      freeze: "Frozen: the account can neither send nor receive the note.",
      unfreeze: "Unfrozen.",
      pool: "Withdrawn: the account can no longer use the pool.",
      "restore-pool": "Restored: the account uses the pool again while its pool-access claim stands.",
    }[what];
  });
}

export async function recoverWalletAction(_prev: { ok?: string; error?: string }, f: FormData) {
  return lifecycleStep(async (op) => {
    await (await import("@/lib/governance")).recoverWallet(op, { lost: field(f, "lost") as `0x${string}`, replacement: field(f, "replacement").trim() as `0x${string}`, reason: field(f, "reason") });
    return "Recovered: the units and the identity are on the new wallet, the reason recorded on-chain.";
  });
}

export async function proposeAction(_prev: { ok?: string; error?: string }, f: FormData) {
  return lifecycleStep(async (op) => {
    const g = await import("@/lib/governance");
    const kind = field(f, "kind") as import("@/lib/governance").Kind;
    const { id } = await g.propose(op, {
      by: field(f, "by") as import("@/lib/governance").InstitutionKey,
      kind,
      reason: field(f, "reason"),
      increase: field(f, "direction") !== "reduce",
      units: Number(field(f, "units")),
      account: ((kind === "SetTrustedIssuer" ? field(f, "issuer") : field(f, "account")).trim() || undefined) as `0x${string}` | undefined,
      approved: field(f, "approved") !== "remove",
    });
    return `Proposed as proposal ${id}, with the proposer's approval.`;
  });
}

export async function approveProposalAction(_prev: { ok?: string; error?: string }, f: FormData) {
  return lifecycleStep(async (op) => {
    await (await import("@/lib/governance")).approve(op, Number(field(f, "id")), field(f, "by") as import("@/lib/governance").InstitutionKey);
    return "Approved.";
  });
}

export async function executeProposalAction(_prev: { ok?: string; error?: string }, f: FormData) {
  return lifecycleStep(async (op) => {
    await (await import("@/lib/governance")).execute(op, Number(field(f, "id")));
    return "Executed.";
  });
}

export async function cancelProposalAction(_prev: { ok?: string; error?: string }, f: FormData) {
  return lifecycleStep(async (op) => {
    await (await import("@/lib/governance")).cancel(op, Number(field(f, "id")));
    return "Cancelled.";
  });
}

export async function attemptForcedTransferAction(_prev: { ok?: string; error?: string }) {
  return lifecycleStep(async (op) => (await import("@/lib/governance")).attemptAgentForcedTransfer(op));
}
