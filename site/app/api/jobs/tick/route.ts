import { NextResponse } from "next/server";
import { runJobs } from "@/lib/jobs";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * The cron that carries background jobs on (ADR 0116): daily on the Vercel Hobby plan, as a
 * backstop. Vercel calls it with the project's CRON_SECRET as a bearer token; nothing else may.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) return new NextResponse("Not permitted.", { status: 401 });
  const r = await runJobs(270_000);
  return NextResponse.json(r);
}
