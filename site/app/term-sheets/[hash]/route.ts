import { currentRegistrant } from "@/lib/access";
import { canonical } from "@/lib/notes/termsheet";
import { termSheetByHash } from "@/lib/notes/termsheets";

export const dynamic = "force-dynamic";

/**
 * A term sheet, at the address its note's identity carries: to signed-in, approved
 * users only. Served in its canonical form, so its bytes hash to the address they are served at.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ hash: string }> }) {
  if (!(await currentRegistrant())) return new Response("Sign in to read term sheets.", { status: 401 });
  const { hash } = await params;
  if (!/^0x[0-9a-fA-F]{64}$/.test(hash)) return new Response("Not found", { status: 404 });
  const record = await termSheetByHash(hash);
  if (!record) return new Response("Not found", { status: 404 });
  return new Response(canonical(record), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": `inline; filename="term-sheet-${hash.slice(0, 10)}.json"`,
      "cache-control": "private, max-age=3600, immutable",
    },
  });
}
