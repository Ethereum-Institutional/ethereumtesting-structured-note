/**
 * The site as the browser tests meet it: a production build (`next start`) against the local chain,
 * reached through the lagging RPC proxy, with a stand-in mailbox and a fresh file store seeded with
 * the people in people.ts. Started by Playwright (playwright.config.ts); the
 * local chain must already be up (../ops/reset.sh).
 */
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createWriteStream, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { startLaggingRpc } from "../lagging-rpc.ts";
import { startMailbox } from "../mailbox.ts";
import { LAGGING_RPC_PORT, PEOPLE, PORT, SERVER_LOG, SITE, MAILBOX_PORT, STORE_DIR, WORK } from "./people.ts";

const SITE_DIR = join(import.meta.dirname, "..", "..");
const MANIFEST = join(SITE_DIR, "..", "ops", "addresses.json");
const CHAIN = process.env.RPC_URL ?? "http://127.0.0.1:8545";

rmSync(WORK, { recursive: true, force: true });
mkdirSync(STORE_DIR, { recursive: true });

const sha256 = (v: string) => createHash("sha256").update(v).digest("hex");
const created = new Date().toISOString();
const expires = new Date(Date.now() + 86_400_000).toISOString();
writeFileSync(
  join(STORE_DIR, "store.json"),
  JSON.stringify({
    registrants: Object.values(PEOPLE).map(({ sid: _sid, ...p }) => ({ ...p, createdAt: created, verifiedAt: p.status === "unverified" ? null : created, decidedAt: null, decidedBy: null })),
    links: [],
    sessions: Object.values(PEOPLE).map((p) => ({ hash: sha256(p.sid), registrantId: p.id, expiresAt: expires })),
    audit: [],
    admissions: [],
  }),
);

const mailbox = await startMailbox(MAILBOX_PORT);
const lagging = await startLaggingRpc(LAGGING_RPC_PORT, CHAIN); // the site reads it as through a public RPC

const log = createWriteStream(SERVER_LOG);
const next = spawn("npx", ["next", "start", "-p", String(PORT)], {
  cwd: SITE_DIR,
  env: {
    ...process.env,
    ...mailbox.env(),
    SITE_URL: SITE,
    MANIFEST_PATH: MANIFEST,
    RPC_URL: lagging.url,
    // The operator demonstrates every portal; the banker is the bank's staff alone (ADR 0089).
    OPERATOR_EMAILS: PEOPLE.operator.email,
    BANK_EMAILS: PEOPLE.banker.email,
    ONBOARDING_EMAILS: "",
    AGENT_EMAILS: "",
    CUSTODIAN_EMAILS: "",
    ALLOW_FILE_STORE: "1",
    FILE_STORE_DIR: STORE_DIR,
  },
  stdio: ["ignore", "pipe", "pipe"],
});
next.stdout.pipe(log);
next.stderr.pipe(log);
next.stdout.pipe(process.stdout);
next.stderr.pipe(process.stderr);

const stop = () => {
  next.kill("SIGTERM");
  void mailbox.close();
  void lagging.close();
};
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
next.on("exit", (code) => process.exit(code ?? 0));
