import { receivePresentation } from "@/lib/admission/service";
import { siteOrigin } from "@/lib/origin";

/**
 * Where holder wallets post presentations (ADR 0045). Public by design: a presentation reveals only
 * what its holder disclosed, it must answer a request this site signed, and the request's
 * signature binds this address, so a presentation cannot be sent here by anyone who did not scan
 * the code. Answers with the verdict, for the wallet to show.
 */
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: { code: "bad_request", message: "The body is not JSON." } }, { status: 400 });
  }
  try {
    const verdict = await receivePresentation(body, await siteOrigin());
    if (!verdict) {
      return Response.json({ error: { code: "not_found", message: "This presentation answers no open request." } }, { status: 404 });
    }
    return Response.json(verdict);
  } catch (e) {
    console.error(e);
    return Response.json({ error: { code: "unavailable", message: "The presentation could not be verified. Try again." } }, { status: 503 });
  }
}
