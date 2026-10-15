import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const dev = process.env.NODE_ENV !== "production";

const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${dev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src https://fonts.gstatic.com",
  "img-src 'self' data:",
  "connect-src 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "base-uri 'none'",
  "object-src 'none'",
].join("; ");

/** @type {import('next').NextConfig} */
export default {
  poweredByHeader: false,
  // The bank's container image runs the self-contained server (ops/vm, ADR 0098); Vercel builds as before.
  ...(process.env.NEXT_OUTPUT === "standalone" ? { output: "standalone" } : {}),
  // Pages that moved keep their old addresses: the client's from /admit to /onboard, and the staff
  // console's from /operator into the portals (ADR 0089).
  async redirects() {
    return [
      { source: "/admit", destination: "/onboard", permanent: true },
      { source: "/operator", destination: "/bank", permanent: false },
      { source: "/operator/clients", destination: "/bank/clients", permanent: false },
      { source: "/operator/admissions", destination: "/bank/onboarding", permanent: false },
      { source: "/operator/custody/:path*", destination: "/custodian", permanent: false },
      { source: "/operator/:path*", destination: "/agent/:path*", permanent: false },
    ];
  },
  outputFileTracingRoot: dirname(fileURLToPath(import.meta.url)),
  outputFileTracingIncludes: { "/overview": ["./content/**"] },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: csp },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "X-Robots-Tag", value: "noindex, nofollow" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          ...(dev ? [] : [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" }]),
        ],
      },
    ];
  },
};
