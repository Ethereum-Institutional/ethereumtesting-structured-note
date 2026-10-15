import { currentOperator } from "@/lib/access";
import { getStore } from "@/lib/store";
import { closeOutOf } from "@/lib/notes/closeout";

export const dynamic = "force-dynamic";

/** A note's close-out statement as JSON, for the evidence pack (S-33, ADR 0084). Staff only. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await currentOperator())) return new Response("Not found", { status: 404 });
  const { id } = await params;
  const n = await getStore().noteById(id);
  if (!n || n.status === "issuing" || n.status === "failed") return new Response("Not found", { status: 404 });
  const statement = await closeOutOf(n);
  return new Response(JSON.stringify(statement, null, 2) + "\n", {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": `attachment; filename="${n.symbol}-close-out-block-${statement.block}.json"`,
      "cache-control": "no-store",
    },
  });
}
