import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { currentRegistrant, isOperator } from "@/lib/access";
import { siteBar } from "@/lib/sitebar";

export const dynamic = "force-dynamic";

/** The solution overview, served in full to approved registrants only and never cached. */
export async function GET(req: Request) {
  const who = await currentRegistrant();
  if (!who) return Response.redirect(new URL("/", req.url), 303);
  const source = await readFile(join(process.cwd(), "content", "solution-overview.html"), "utf8");
  // The bar goes immediately after the overview's stylesheet, before its first element, so it
  // is the first thing in the document flow and its rules override the overview's own.
  const at = source.indexOf("</style>") + "</style>".length;
  if (at < "</style>".length) throw new Error("Overview has no stylesheet to anchor the site bar.");
  const html = source.slice(0, at) + "\n" + siteBar(who.email, isOperator(who.email)) + source.slice(at);
  const page = `<!doctype html>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n<meta name="robots" content="noindex, nofollow">\n${html}`;
  return new Response(page, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "private, no-store",
    },
  });
}
