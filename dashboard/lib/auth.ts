import "server-only";
import { cookies } from "next/headers";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import {
  findUserByEmail,
  createUser,
  storeLoginToken,
  consumeLoginToken,
  createSession,
  userForSession,
  destroySession,
  touchLogin,
} from "./db";
import type { Role, User } from "./db/types";

/**
 * Magic-link authentication for the demo platform.
 *
 * IMPORTANT: this is demo-grade, not production auth. It does what it needs to — single-use
 * hashed tokens, hashed session records, httpOnly cookies, no secrets in URLs beyond the
 * one-time token — but it has had no security review, no rate limiting, no audit logging, and
 * no account-recovery story. Do not put real user data behind it.
 *
 * Delivery: there is no mail provider wired up, so the link is returned to the caller and shown
 * on screen. That is a deliberate choice for a live demo — Supabase's built-in email is
 * rate-limited to a handful of messages an hour on the free tier, which is not something to
 * depend on in front of an audience. Setting RESEND_API_KEY switches to real email.
 */

const SESSION_COOKIE = "platform_session";
const TOKEN_TTL_MINUTES = 20;
const SESSION_TTL_DAYS = 7;

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/**
 * Who counts as staff.
 *
 * Staff access needs a shared code, not just an email address. This matters because the
 * platform is used at events where people sign themselves up: an email domain rule alone would
 * let any attendee type a company address and become the compliance officer, which is not a
 * demo failure so much as a live authorisation bypass.
 *
 * So: the email must be on the allowlist (or match the staff domain) AND the request must carry
 * the code. Everyone else becomes an investor, which is what an attendee should be.
 */
function staffEmailPermitted(email: string): boolean {
  const explicit = (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  if (explicit.length) return explicit.includes(email);
  const domain = (process.env.ADMIN_EMAIL_DOMAIN ?? "openzeppelin.com").toLowerCase();
  return Boolean(domain) && email.endsWith(`@${domain}`);
}

function staffCodeMatches(code: string | undefined): boolean {
  const expected = process.env.STAFF_ACCESS_CODE ?? "";
  if (!expected) return false; // No code configured means no staff sign-ups, which is the safe default.
  if (!code) return false;
  return safeEqual(code.trim(), expected);
}

function roleForSignIn(email: string, staffCode?: string): Role {
  return staffCodeMatches(staffCode) && staffEmailPermitted(email) ? "admin" : "investor";
}

export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim());
}

export type MagicLink = { user: User; url: string; emailed: boolean; grantedRole: Role };

/**
 * Creates (or finds) the account for an email and issues a single-use sign-in link.
 *
 * Returns the URL so the caller can display it. Only the token's hash is stored, so the table
 * cannot be used to sign in as anyone even if it leaks.
 */
export async function requestMagicLink(
  rawEmail: string,
  origin: string,
  staffCode?: string,
): Promise<MagicLink> {
  const email = rawEmail.trim().toLowerCase();
  if (!isValidEmail(email)) throw new Error("That does not look like an email address.");

  // A wrong or missing code is not a silent downgrade to investor: someone trying to reach the
  // compliance side needs to know their code was rejected.
  if (staffCode && staffCode.trim() && !staffCodeMatches(staffCode)) {
    throw new Error("That staff access code is not valid.");
  }
  if (staffCode && staffCode.trim() && !staffEmailPermitted(email)) {
    throw new Error("That email address is not permitted for staff access.");
  }

  let user = await findUserByEmail(email);
  if (!user) {
    user = await createUser({
      id: `usr_${randomBytes(8).toString("hex")}`,
      email,
      role: roleForSignIn(email, staffCode),
      displayName: null,
      createdAt: new Date().toISOString(),
      lastLoginAt: null,
    });
  }

  // The privilege travels with the link, not the account. Presenting the staff code mints an
  // admin link; not presenting it mints an investor link, even for a staff address. So a
  // code-less sign-in cannot yield an admin session, and it cannot lock staff out either —
  // signing in again with the code restores access.
  const grantedRole: Role = roleForSignIn(email, staffCode);
  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + TOKEN_TTL_MINUTES * 60_000).toISOString();
  await storeLoginToken(hash(token), user.id, expiresAt, grantedRole);

  const url = `${origin}/login/verify?token=${token}`;
  const emailed = await maybeSendEmail(email, url);
  return { user, url, emailed, grantedRole };
}

/** Sends the link if a provider is configured. Returns whether it actually went out. */
async function maybeSendEmail(to: string, url: string): Promise<boolean> {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.MAIL_FROM;
  if (!key || !from) return false;
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from,
        to,
        subject: "Your sign-in link",
        text: `Sign in here (valid for ${TOKEN_TTL_MINUTES} minutes):\n\n${url}\n`,
      }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** Exchanges a valid link token for a session cookie. */
export async function completeSignIn(token: string): Promise<User | null> {
  if (!token) return null;
  const consumed = await consumeLoginToken(hash(token));
  if (!consumed) return null;
  const { userId, grantedRole } = consumed;

  // Bring the stored role in line with what this link granted.
  const { setUserRole } = await import("./db");
  await setUserRole(userId, grantedRole);

  const sessionToken = randomBytes(32).toString("hex");
  const expires = new Date(Date.now() + SESSION_TTL_DAYS * 86_400_000);
  await createSession(hash(sessionToken), userId, expires.toISOString());
  await touchLogin(userId);

  const jar = await cookies();
  jar.set(SESSION_COOKIE, sessionToken, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires,
  });

  const { getUser } = await import("./db");
  return getUser(userId);
}

export async function currentUser(): Promise<User | null> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  try {
    return await userForSession(hash(token));
  } catch (err) {
    // A failed lookup is not the same as "not signed in", and treating it as such silently signs
    // people out under load. It still has to degrade to null here — a page render cannot recover —
    // but it must be visible in the logs rather than looking like an ordinary anonymous visit.
    console.error("session lookup failed; treating request as anonymous", err);
    return null;
  }
}

export async function signOut(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) {
    try {
      await destroySession(hash(token));
    } catch {
      /* session already gone */
    }
  }
  jar.delete(SESSION_COOKIE);
}

export async function requireUser(): Promise<User> {
  const u = await currentUser();
  if (!u) throw new Error("Please sign in.");
  return u;
}

export async function requireAdmin(): Promise<User> {
  const u = await requireUser();
  if (u.role !== "admin") throw new Error("This area is for compliance staff.");
  return u;
}

/** Constant-time compare, for anywhere a caller-supplied token is checked directly. */
export function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}
