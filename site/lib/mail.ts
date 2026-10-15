import "server-only";

/**
 * Outbound mail through Resend.
 *
 * In production, a missing configuration is an error: a sign-in code that cannot be delivered must
 * never be shown on screen instead, since that would let anyone sign in as any address. In development
 * the message is written to the server log.
 */

export class MailUnavailable extends Error {}

export async function sendMail(to: string, subject: string, text: string): Promise<void> {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.MAIL_FROM;
  if (!key || !from) {
    if (process.env.NODE_ENV === "production") throw new MailUnavailable("Mail is not configured.");
    console.log(`\n[mail, development only] to ${to}\nsubject: ${subject}\n\n${text}\n`);
    return;
  }
  // RESEND_API_URL is for the tests' stand-in only; production always posts to Resend.
  const res = await fetch(process.env.RESEND_API_URL ?? "https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from, to, subject, text }),
  });
  if (!res.ok) throw new MailUnavailable(`Mail provider returned ${res.status}.`);
}
