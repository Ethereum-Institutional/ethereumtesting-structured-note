import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { currentRegistrant } from "@/lib/access";

export const dynamic = "force-dynamic";

/** The solution overview, served in full to approved registrants only and never cached. */
export async function GET(req: Request) {
  const who = await currentRegistrant();
  if (!who) return Response.redirect(new URL("/", req.url), 303);
  const html = await readFile(join(process.cwd(), "content", "solution-overview.html"), "utf8");
  const page = `<!doctype html>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n<meta name="robots" content="noindex, nofollow">\n${html}`;
  return new Response(page, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "private, no-store",
    },
  });
}
