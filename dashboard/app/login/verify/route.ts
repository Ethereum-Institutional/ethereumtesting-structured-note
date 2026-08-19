import { NextResponse } from "next/server";
import { completeSignIn } from "@/lib/auth";

/**
 * Consumes a magic-link token and starts a session.
 *
 * A route handler rather than a page so the cookie is set on a real response and the redirect
 * lands the user straight in the right place for their role — investors in their own account,
 * staff in the review queue.
 */
export async function GET(req: Request) {
  const token = new URL(req.url).searchParams.get("token") ?? "";
  const origin = new URL(req.url).origin;

  let user = null;
  try {
    user = await completeSignIn(token);
  } catch (e) {
    console.error("sign-in failed", e);
  }

  if (!user) {
    return NextResponse.redirect(`${origin}/login?error=link`, { status: 303 });
  }
  return NextResponse.redirect(`${origin}${user.role === "admin" ? "/portal/admin" : "/account"}`, {
    status: 303,
  });
}
