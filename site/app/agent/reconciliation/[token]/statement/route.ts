import { currentStaff } from "@/lib/access";
import { noteOnRecord } from "@/lib/notes/registry";
import { parseAsAt, positionsCsv, statementOf } from "@/lib/notes/reconcile";

export const dynamic = "force-dynamic";

/** A note's reconciliation statement as JSON or as a CSV of its positions. The Agent's staff only. */
export async function GET(req: Request, { params }: { params: Promise<{ token: string }> }) {
  if (!(await currentStaff("agent"))) return new Response("Not found", { status: 404 });
  const { token } = await params;
  const rec = await noteOnRecord(token).catch(() => null);
  if (!rec) return new Response("Not found", { status: 404 });
  const url = new URL(req.url);
  const format = url.searchParams.get("format") === "csv" ? "csv" : "json";
  let s;
  try {
    s = await statementOf(rec, parseAsAt(url.searchParams.get("asAt")));
  } catch (e) {
    return new Response((e as Error).message, { status: 400 });
  }
  const name = `${rec.symbol}-statement-block-${s.block}.${format}`;
  return new Response(format === "csv" ? positionsCsv(s) : JSON.stringify(s, null, 2) + "\n", {
    headers: {
      "content-type": format === "csv" ? "text/csv; charset=utf-8" : "application/json; charset=utf-8",
      "content-disposition": `attachment; filename="${name}"`,
      "cache-control": "no-store",
    },
  });
}
