import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { getStore, type Registrant } from "./store";
import { sendMail } from "./mail";
import { emailList as list, isOperator, normaliseEmail } from "./operators";

export { isOperator, normaliseEmail };

/**
 * Registration and access.
 *
 * A visitor registers with name, organisation and email, and receives a one-time link. Opening
 * the link shows a confirmation step; the link is consumed only when that step is submitted, so a
 * mail scanner that fetches links in advance cannot use it up. A first confirmation verifies the
 * address and places the registration in the approval queue. Once an operator approves it, a
 * confirmed link starts a session.
 *
 * Every request for a link returns the same response whether or not the address is known, so the
 * form cannot be used to learn who has registered. Operators are named by an explicit list in
 * OPERATOR_EMAILS; there is no default and no domain rule for operators.
 *
 * AUTO_APPROVE_DOMAINS lists domains whose addresses are approved on verification, without
 * waiting for an operator. It grants reading access only, and only after the link has proved
 * control of the mailbox. Addresses on other domains wait for an operator.
 */

export const LINK_TTL_MINUTES = 30;
const SESSION_TTL_DAYS = 14;
const LINK_INTERVAL_SECONDS = 60;
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

async function issueLink(r: Registrant, origin: string, subject: string, intro: string): Promise<void> {
  const store = getStore();
  const last = await store.latestLinkAt(r.id);
  if (last && Date.now() - Date.parse(last) < LINK_INTERVAL_SECONDS * 1000) return; // throttled, silently
  const token = randomBytes(32).toString("base64url");
  const url = `${origin}/access?token=${token}`;
  // Sent before it is stored, so a failed send leaves no link behind to count against the
  // throttle. A link that fails to store after sending is merely dead; the visitor asks again.
  await sendMail(
    r.email,
    subject,
    `${intro}\n\n${url}\n\nThe link is valid for ${LINK_TTL_MINUTES} minutes and can be used once. ` +
      `If you did not request it, no action is needed.\n`,
  );
  await store.putLink(sha256(token), r.id, new Date(Date.now() + LINK_TTL_MINUTES * 60_000).toISOString());
}

/** Registration. Unknown addresses are registered; known addresses are sent a sign-in link. */
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
    await issueLink(r, origin, "Confirm your email address", "Confirm your email address to continue:");
  }
  return { ok: true as const };
}

/** Sign-in for an existing registration. Silent for unknown or revoked addresses. */
export async function requestSignIn(rawEmail: string, origin: string) {
  const email = normaliseEmail(rawEmail);
  if (!validEmail(email)) return { ok: false as const, error: "Enter a valid email address." };
  const r = await getStore().registrantByEmail(email);
  if (r && r.status !== "revoked") await issueLink(r, origin, "Your sign-in link", "Sign in:");
  return { ok: true as const };
}

export async function linkUsable(token: string): Promise<boolean> {
  return Boolean(token) && getStore().linkUsable(sha256(token), now());
}

export type Confirmation = "signed-in" | "pending" | "invalid";

/** Consumes a link. Verifies the address on first use; starts a session once approved. */
export async function confirm(token: string, origin: string): Promise<Confirmation> {
  const store = getStore();
  const id = token ? await store.consumeLink(sha256(token), now()) : null;
  if (!id) return "invalid";
  let r = (await store.registrantById(id))!;
  if (r.status === "revoked") return "invalid";

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
      sendMail(to, "Registration awaiting approval", `${r.name}, ${r.organisation} <${r.email}>\n\nReview: ${origin}/operator\n`),
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

export async function signOut() {
  const jar = await cookies();
  const sid = jar.get(COOKIE)?.value;
  if (sid) await getStore().deleteSession(sha256(sid));
  jar.delete(COOKIE);
}

/** Operator decisions. The caller must be a current operator; checked here, not only in the page. */
export async function decide(registrantId: string, decision: "approve" | "revoke", origin: string) {
  const op = await currentOperator();
  if (!op) throw new Error("Not permitted.");
  const store = getStore();
  const r = await store.registrantById(registrantId);
  if (!r) throw new Error("No such registration.");
  if (decision === "revoke" && r.email === op.email) throw new Error("An operator cannot revoke their own access.");

  if (decision === "approve") {
    if (r.status !== "pending" && r.status !== "revoked") return;
    await store.setStatus(r.id, "approved", { decidedAt: now(), decidedBy: op.email });
    await store.audit({ at: now(), actor: op.email, action: "approved", subject: r.email });
    await sendMail(r.email, "Access approved", `Your access has been approved. Sign in at:\n\n${origin}\n`).catch(() => {});
  } else {
    await store.setStatus(r.id, "revoked", { decidedAt: now(), decidedBy: op.email });
    await store.deleteSessionsFor(r.id);
    await store.audit({ at: now(), actor: op.email, action: "revoked", subject: r.email });
  }
}
