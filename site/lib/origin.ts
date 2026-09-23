import "server-only";
import { headers } from "next/headers";

/**
 * The origin written into emailed links. In production it comes only from SITE_URL: taking it
 * from the request's Host header would let anyone have a genuine token mailed out inside a link
 * to a domain of their choosing.
 */
export async function siteOrigin(): Promise<string> {
  const configured = process.env.SITE_URL?.replace(/\/+$/, "");
  if (configured) return configured;
  if (process.env.NODE_ENV === "production") throw new Error("SITE_URL is not set.");
  const h = await headers();
  return `${h.get("x-forwarded-proto") ?? "http"}://${h.get("host")}`;
}
