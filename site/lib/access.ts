import "server-only";
import { createHash, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { getStore, type Registrant } from "./store";
import { sendMail } from "./mail";
import { emailList as list, hasRole, isAdmin, isOperator, normaliseEmail, type Role } from "./operators";

export { isOperator, normaliseEmail };

/**
 * Registration and access.
 *
 * A visitor registers with name, organisation and email, and is sent a six-digit code, which it
 * types into the page it is on (ADR 0093). A code cannot be used up by a mail scanner, as a link
 * could. It lasts ten minutes, works once, and is spent after five wrong tries; asking for a new
 * one retires the one before. Only a salted hash of it is stored. A first code verifies the address
 * and places the registration in the approval queue. Once an operator approves it, a code starts
 * a session.
 *
 * Every request for a code returns the same response whether or not the address is known, and a
 * wrong code reads the same as an unknown address, so the forms cannot be used to learn who has
 * registered. Operators are named by an explicit list in
 * OPERATOR_EMAILS; there is no default and no domain rule for operators.
 *
 * AUTO_APPROVE_DOMAINS lists domains whose addresses are approved on verification, without
 * waiting for an operator. It grants reading access only, and only after a code has proved
 * control of the mailbox. Addresses on other domains wait for an operator.
 */

export const CODE_TTL_MINUTES = 10;
/** Wrong tries after which a code is spent. */
const CODE_ATTEMPTS = 5;
const SESSION_TTL_DAYS = 14;
const CODE_INTERVAL_SECONDS = 60;
const COOKIE = process.env.NODE_ENV === "production" ? "__Host-session" : "session";

const sha256 = (v: string) => createHash("sha256").update(v).digest("hex");
const now = () => new Date().toISOString();

export function validEmail(email: string): boolean {
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email);
}


/** Exact domain match on the part after the last "@"; subdomains do not match. */
export function autoApproved(email: string): boolean {
  const domain = email.slice(email.lastIndexOf("@") + 1);
  return list(process.env.AUTO_APPROVE_DOMAINS).map((d) => d.replace(/^@/, "")).includes(domain);
}

function clean(v: string, max: number): string {
  return v.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

const codeHash = (salt: string, code: string) => sha256(`${salt}:${code}`);

/**
 * The page that takes the code for this address, linked from the mail so it can be opened in a new
 * tab or later. The link carries the address only, never the code: sign-in stays code-only (ADR 0099).
 */
export function codePageUrl(origin: string, email: string): string {
  return `${origin.replace(/\/+$/, "")}/access?email=${encodeURIComponent(email)}`;
}

/** Sends a one-use six-digit code; false when throttled, as one was sent moments ago. */
async function issueCode(r: Registrant, subject: string, intro: string, origin: string): Promise<boolean> {
  const store = getStore();
  const last = await store.latestCodeAt(r.id);
  if (last && Date.now() - Date.parse(last) < CODE_INTERVAL_SECONDS * 1000) return false; // throttled, silently
  const code = randomInt(0, 1_000_000).toString().padStart(6, "0");
  const salt = randomBytes(16).toString("base64url");
  // Sent before it is stored, so a failed send leaves no code behind to count against the
  // throttle. A code that fails to store after sending is merely dead; the visitor asks again.
  await sendMail(
    r.email,
    subject,
    `${intro}\n\n    ${code}\n\nType it into the page you asked from, or open this page and type it there:\n\n${codePageUrl(origin, r.email)}\n\n` +
      `It is valid for ${CODE_TTL_MINUTES} minutes and can be used once. If you did not ask for it, no action is needed.\n`,
  );
  await store.putCode({ id: `code_${randomBytes(9).toString("base64url")}`, registrantId: r.id, salt, hash: codeHash(salt, code), expiresAt: new Date(Date.now() + CODE_TTL_MINUTES * 60_000).toISOString() });
  return true;
}

/** Registration. Unknown addresses are registered; every address not revoked is sent a code. */
export async function register(input: { email: string; name: string; organisation: string }, origin: string) {
  const email = normaliseEmail(input.email);
  const name = clean(input.name, 120);
  const organisation = clean(input.organisation, 160);
  if (!validEmail(email)) return { ok: false as const, error: "Enter a valid email address." };
  if (!name || !organisation) return { ok: false as const, error: "Name and organisation are required." };

  const store = getStore();
  let r = await store.registrantByEmail(email);
  if (!r) {
    await store.createRegistrant({
      id: `reg_${randomBytes(9).toString("base64url")}`,
      email,
      name,
      organisation,
      status: "unverified",
      createdAt: now(),
      verifiedAt: null,
      decidedAt: null,
      decidedBy: null,
    });
    r = (await store.registrantByEmail(email))!;
    await store.audit({ at: now(), actor: email, action: "registered", subject: email });
  }
  if (r.status !== "revoked") {
    await issueCode(r, "Your code to confirm your email address", "Your code to confirm your email address:", origin);
  }
  return { ok: true as const, email };
}

/** Sign-in for an existing registration. Silent for unknown or revoked addresses. */
export async function requestSignIn(rawEmail: string, origin: string) {
  const email = normaliseEmail(rawEmail);
  if (!validEmail(email)) return { ok: false as const, error: "Enter a valid email address." };
  const r = await getStore().registrantByEmail(email);
  if (r && r.status !== "revoked") await issueCode(r, "Your sign-in code", "Your sign-in code:", origin);
  return { ok: true as const, email };
}

export type Confirmation = "signed-in" | "pending" | "invalid";

/**
 * Checks a code typed for an address. Right, it is used: it verifies the address on first use,
 * and starts a session once the registration is approved. Wrong, it counts against the code, which
 * is spent after five. An unknown address, no code, a wrong code, and a spent or expired one all
 * read the same.
 */
export async function confirm(rawEmail: string, rawCode: string, origin: string): Promise<Confirmation> {
  const store = getStore();
  const email = normaliseEmail(rawEmail);
  const code = rawCode.replace(/\s+/g, "");
  if (!validEmail(email) || !/^\d{6}$/.test(code)) return "invalid";
  let r = await store.registrantByEmail(email);
  if (!r || r.status === "revoked") return "invalid";
  const active = await store.activeCode(r.id, now());
  if (!active) return "invalid";
  const given = Buffer.from(codeHash(active.salt, code), "hex");
  if (!timingSafeEqual(given, Buffer.from(active.hash, "hex"))) {
    await store.failCode(active.id, CODE_ATTEMPTS, now());
    return "invalid";
  }
  if (!(await store.useCode(active.id, now()))) return "invalid";
  const id = r.id;

  if (r.status === "unverified") {
    const rule = isOperator(r.email) ? "operator list" : autoApproved(r.email) ? "domain rule" : null;
    await store.setStatus(r.id, rule ? "approved" : "pending", {
      verifiedAt: now(),
      ...(rule ? { decidedAt: now(), decidedBy: rule } : {}),
    });
    await store.audit({ at: now(), actor: r.email, action: rule ? `verified, approved by ${rule}` : "verified", subject: r.email });
    r = (await store.registrantById(id))!;
    if (!rule) await notifyOperators(r, origin);
  }
  if (r.status !== "approved") return "pending";
  if (!r.verifiedAt) {
    // Approved by staff before the address was confirmed: this code confirms it.
    await store.setStatus(r.id, r.status, { verifiedAt: now() });
    await store.audit({ at: now(), actor: r.email, action: "verified", subject: r.email });
  }

  const sid = randomBytes(32).toString("base64url");
  const expires = new Date(Date.now() + SESSION_TTL_DAYS * 86_400_000);
  await store.putSession(sha256(sid), r.id, expires.toISOString());
  (await cookies()).set(COOKIE, sid, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires,
  });
  await store.audit({ at: now(), actor: r.email, action: "signed in", subject: r.email });
  return "signed-in";
}

async function notifyOperators(r: Registrant, origin: string) {
  await Promise.allSettled(
    list(process.env.OPERATOR_EMAILS).map((to) =>
      sendMail(to, "Registration awaiting approval", `${r.name}, ${r.organisation} <${r.email}>\n\nReview: ${origin}/bank\n`),
    ),
  );
}

/** The signed-in registrant, if still approved. Checked on every request, so revocation is immediate. */
export async function currentRegistrant(): Promise<Registrant | null> {
  const sid = (await cookies()).get(COOKIE)?.value;
  if (!sid) return null;
  const store = getStore();
  const id = await store.sessionRegistrant(sha256(sid), now());
  if (!id) return null;
  const r = await store.registrantById(id);
  return r && r.status === "approved" ? r : null;
}

export async function currentOperator(): Promise<Registrant | null> {
  const r = await currentRegistrant();
  return r && isOperator(r.email) ? r : null;
}

/** The signed-in registrant, if staff in the given portal (ADR 0089). */
export async function currentStaff(role: Role): Promise<Registrant | null> {
  const r = await currentRegistrant();
  return r && hasRole(r.email, role) ? r : null;
}

export async function signOut() {
  const jar = await cookies();
  const sid = jar.get(COOKIE)?.value;
  if (sid) await getStore().deleteSession(sha256(sid));
  jar.delete(COOKIE);
}

/**
 * An admin deletes a registration (ADR 0100): the registration, its codes, sessions and onboarding
 * requests, so the address may register afresh; the audit log keeps the deletion. Off-chain only,
 * and refused while any wallet onboarded for it holds an identity on the chain, which no deletion
 * here could remove: the claims are revoked and the wallet offboarded first.
 */
export async function deleteRegistration(registrantId: string): Promise<string> {
  const op = await currentRegistrant();
  if (!op || !isAdmin(op.email)) throw new Error("Only an admin may delete a registration.");
  const store = getStore();
  const r = await store.registrantById(registrantId);
  if (!r) throw new Error("No such registration.");
  if (r.id === op.id) throw new Error("An admin cannot delete their own registration.");
  const { identityOf } = await import("./identity/onchain");
  for (const a of await store.admissionsFor(r.id)) {
    const wallet = (a.data as { wallet?: `0x${string}` }).wallet;
    if (wallet && (await identityOf(wallet))) {
      throw new Error(`${r.email} has an identity on the chain for wallet ${wallet}. Offboard the wallet first; the chain cannot be erased from here.`);
    }
  }
  await store.deleteRegistrant(r.id);
  await store.audit({ at: now(), actor: op.email, action: "deleted the registration", subject: r.email });
  return `Deleted ${r.email}. The address may register again.`;
}

/** Operator decisions. The caller must be a current operator; checked here, not only in the page. */
/** Staff send a fresh confirmation code to a registration that has not confirmed its address (ADRs 0077, 0093). */
export async function resendConfirmation(registrantId: string, origin: string): Promise<void> {
  const op = await currentOperator();
  if (!op) throw new Error("Not permitted.");
  const store = getStore();
  const r = await store.registrantById(registrantId);
  if (!r || r.status !== "unverified") throw new Error("Only an unconfirmed registration is sent a fresh code.");
  if (!(await issueCode(r, "Your code to confirm your email address", "Your code to confirm your email address:", origin))) {
    throw new Error(`A code was sent less than ${CODE_INTERVAL_SECONDS} seconds ago; try again shortly.`);
  }
  await store.audit({ at: now(), actor: op.email, action: "sent a fresh confirmation code", subject: r.email });
}

export async function decide(registrantId: string, decision: "approve" | "revoke", origin: string) {
  const op = await currentOperator();
  if (!op) throw new Error("Not permitted.");
  const store = getStore();
  const r = await store.registrantById(registrantId);
  if (!r) throw new Error("No such registration.");
  if (decision === "revoke" && r.email === op.email) throw new Error("An operator cannot revoke their own access.");

  if (decision === "approve") {
    // An unverified registration may be approved ahead of its confirmation: signing in still
    // needs a code sent to the address, so approval alone gives no access (ADR 0077).
    if (r.status !== "pending" && r.status !== "revoked" && r.status !== "unverified") return;
    await store.setStatus(r.id, "approved", { decidedAt: now(), decidedBy: op.email });
    await store.audit({ at: now(), actor: op.email, action: "approved", subject: r.email });
    await sendMail(r.email, "Access approved", `Your access has been approved. Sign in at:\n\n${origin}\n`).catch(() => {});
  } else {
    await store.setStatus(r.id, "revoked", { decidedAt: now(), decidedBy: op.email });
    await store.deleteSessionsFor(r.id);
    await store.audit({ at: now(), actor: op.email, action: "revoked", subject: r.email });
  }
}
