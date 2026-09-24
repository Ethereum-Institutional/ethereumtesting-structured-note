import { signOut } from "@/lib/access";

/** Plain form endpoint for pages that are not React, such as the served overview. POST only;
 * the session cookie is SameSite=Lax, so a cross-site form cannot carry it here. */
export async function POST(req: Request) {
  await signOut();
  return Response.redirect(new URL("/", req.url), 303);
}
