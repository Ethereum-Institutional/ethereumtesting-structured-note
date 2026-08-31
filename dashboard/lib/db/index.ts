import "server-only";
import fs from "node:fs";
import path from "node:path";
import type { Application, ApplicationEvent, ApplicationStatus, User, Role } from "./types";

/**
 * Platform store with a swappable backend.
 *
 * Postgres is the real target — a `POSTGRES_URL` or `DATABASE_URL` from Supabase, Neon or any
 * other provider is all it needs. Without one, a JSON file keeps the portal fully usable in
 * local development. Both drivers implement the same interface, so nothing above this file
 * knows which is live.
 */

const CONNECTION = process.env.POSTGRES_URL ?? process.env.DATABASE_URL ?? "";

/**
 * On Vercel only /tmp is writable, and it lives as long as the serverless instance does. So the
 * file driver still works there, but a cold start wipes it — hence the distinct name, which the
 * UI surfaces so nobody mistakes it for durable storage.
 */
const ON_VERCEL = Boolean(process.env.VERCEL);
export const driverName = CONNECTION ? "postgres" : ON_VERCEL ? "ephemeral file" : "file";
export const isDurable = Boolean(CONNECTION);
export const hasPostgres = Boolean(CONNECTION);
const usingFile = () => !CONNECTION;

/**
 * The one place the application's column names are written down.
 *
 * Both the SELECT list and the row mapping are derived from this, so a column cannot be added
 * to one and forgotten in the other — which is exactly the bug an earlier hand-maintained pair
 * of lists was waiting to produce.
 */
const APP_FIELDS: Array<[keyof Application, string]> = [
  ["id", "id"],
  ["reference", "reference"],
  ["userId", "user_id"],
  ["applicantName", "applicant_name"],
  ["wallet", "wallet"],
  ["status", "status"],
  ["submittedAt", "submitted_at"],
  ["accountType", "account_type"],
  ["legalName", "legal_name"],
  ["dob", "dob"],
  ["nationality", "nationality"],
  ["residentialAddress", "residential_address"],
  ["passportNumber", "passport_number"],
  ["taxId", "tax_id"],
  ["entityName", "entity_name"],
  ["entityForm", "entity_form"],
  ["registrationNumber", "registration_number"],
  ["incorporationCountry", "incorporation_country"],
  ["registeredOffice", "registered_office"],
  ["repName", "rep_name"],
  ["repPassportNumber", "rep_passport_number"],
  ["country", "country"],
  ["phone", "phone"],
  ["sourceOfFunds", "source_of_funds"],
  ["annualIncome", "annual_income"],
  ["netFinancialAssets", "net_financial_assets"],
  ["entityNetAssets", "entity_net_assets"],
  ["accreditationLevel", "accreditation_level"],
  ["accreditationBasis", "accreditation_basis"],
  ["sanctionsResult", "sanctions_result"],
  ["pepResult", "pep_result"],
  ["adverseMediaResult", "adverse_media_result"],
  ["allocation", "allocation"],
  ["startingCash", "starting_cash"],
  ["reviewerNotes", "reviewer_notes"],
  ["rejectionReason", "rejection_reason"],
  ["onchainIdentity", "onchain_identity"],
  ["claimDigest", "claim_digest"],
  ["approvedAt", "approved_at"],
  ["approvedBy", "approved_by"],
  ["updatedAt", "updated_at"],
];

const CAMEL_TO_SNAKE = new Map(APP_FIELDS);
const APP_COLUMNS = APP_FIELDS.map(([, s]) => s).join(", ");
const NUMERIC = new Set(["country", "annualIncome", "netFinancialAssets", "entityNetAssets"]);

function rowToApp(r: any): Application {
  const out: any = {};
  for (const [camel, snake] of APP_FIELDS) {
    const v = r[snake];
    out[camel] = NUMERIC.has(camel as string) ? (v == null ? null : Number(v)) : v;
  }
  return out as Application;
}

// --------------------------------------------------------------------- //
//                              File driver                              //
// --------------------------------------------------------------------- //

const FILE = ON_VERCEL
  ? "/tmp/apac-platform.json"
  : path.join(process.cwd(), ".data", "platform.json");

type FileShape = {
  users: User[];
  applications: Application[];
  events: ApplicationEvent[];
  loginTokens: Array<{ tokenHash: string; userId: string; createdAt: string; expiresAt: string; usedAt: string | null; grantedRole?: Role }>;
  sessions: Array<{ tokenHash: string; userId: string; createdAt: string; expiresAt: string }>;
  nextEventId: number;
};

function readFile(): FileShape {
  try {
    const d = JSON.parse(fs.readFileSync(FILE, "utf8"));
    return {
      users: d.users ?? [],
      applications: d.applications ?? [],
      events: d.events ?? [],
      loginTokens: d.loginTokens ?? [],
      sessions: d.sessions ?? [],
      nextEventId: d.nextEventId ?? 1,
    };
  } catch {
    return { users: [], applications: [], events: [], loginTokens: [], sessions: [], nextEventId: 1 };
  }
}

function writeFile(data: FileShape) {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(data, null, 2));
}

// --------------------------------------------------------------------- //
//                            Postgres driver                            //
// --------------------------------------------------------------------- //

let sqlClient: any = null;

async function sql() {
  if (!sqlClient) {
    const postgres = (await import("postgres")).default;
    // prepare: false is required, not advisory. Supabase's POSTGRES_URL points at pgbouncer in
    // transaction mode (port 6543), where a connection is handed to another client between
    // statements — so server-side prepared statements cannot be assumed to survive.
    //
    // max: 1 because these run in serverless functions: many short-lived instances each opening
    // their own pool would exhaust the pooler's client limit long before one instance needed a
    // second connection.
    sqlClient = postgres(CONNECTION, {
      ssl: "require",
      prepare: false,
      // A warm instance serves several requests at once, and a pool of one turns every
      // concurrent page load into a queue — which is what made simultaneous sign-ups pile up.
      // Five per instance is still modest against the pooler's client limit.
      max: 5,
      idle_timeout: 20,
      connect_timeout: 10,
    });
  }
  return sqlClient;
}

/**
 * Applies the schema, at most once per process.
 *
 * The DDL is idempotent, but it is not cheap: a dozen statements, each a round trip to a database
 * in another region. Re-running it on every sign-in cost seconds per request and, behind a small
 * connection pool, serialised concurrent traffic badly enough that simultaneous sign-ups failed.
 *
 * The promise itself is cached rather than a boolean, so concurrent callers await the same run
 * instead of racing to start their own.
 */
let schemaReady: Promise<void> | null = null;

export async function ensureSchema(): Promise<void> {
  if (usingFile()) return;
  if (!schemaReady) {
    schemaReady = (async () => {
      const s = await sql();
      const ddl = fs.readFileSync(path.join(process.cwd(), "lib", "db", "schema.sql"), "utf8");
      await s.unsafe(ddl);
    })().catch((e) => {
      // Do not cache a failure: the next request should be able to try again.
      schemaReady = null;
      throw e;
    });
  }
  return schemaReady;
}

// --------------------------------------------------------------------- //
//                                 Users                                 //
// --------------------------------------------------------------------- //

function rowToUser(r: any): User {
  return {
    id: r.id,
    email: r.email,
    role: r.role,
    displayName: r.display_name,
    createdAt: r.created_at,
    lastLoginAt: r.last_login_at,
  };
}

export async function findUserByEmail(email: string): Promise<User | null> {
  const key = email.trim().toLowerCase();
  if (usingFile()) return readFile().users.find((u) => u.email === key) ?? null;
  const s = await sql();
  const rows = await s.unsafe(
    `select id, email, role, display_name, created_at, last_login_at from users where email = $1`,
    [key],
  );
  return rows.length ? rowToUser(rows[0]) : null;
}

export async function getUser(id: string): Promise<User | null> {
  if (usingFile()) return readFile().users.find((u) => u.id === id) ?? null;
  const s = await sql();
  const rows = await s.unsafe(
    `select id, email, role, display_name, created_at, last_login_at from users where id = $1`,
    [id],
  );
  return rows.length ? rowToUser(rows[0]) : null;
}

export async function createUser(user: User): Promise<User> {
  if (usingFile()) {
    const d = readFile();
    d.users.push(user);
    writeFile(d);
    return user;
  }
  const s = await sql();
  await s.unsafe(
    `insert into users (id, email, role, display_name, created_at, last_login_at)
     values ($1,$2,$3,$4,$5,$6) on conflict (email) do nothing`,
    [user.id, user.email, user.role, user.displayName, user.createdAt, user.lastLoginAt],
  );
  return (await findUserByEmail(user.email)) ?? user;
}

export async function touchLogin(userId: string): Promise<void> {
  const now = new Date().toISOString();
  if (usingFile()) {
    const d = readFile();
    const u = d.users.find((x) => x.id === userId);
    if (u) u.lastLoginAt = now;
    writeFile(d);
    return;
  }
  const s = await sql();
  await s.unsafe(`update users set last_login_at = $1 where id = $2`, [now, userId]);
}

export async function listUsers(): Promise<User[]> {
  if (usingFile()) return readFile().users;
  const s = await sql();
  const rows = await s.unsafe(
    `select id, email, role, display_name, created_at, last_login_at from users order by created_at asc`,
  );
  return rows.map(rowToUser);
}

// --------------------------------------------------------------------- //
//                        Login tokens and sessions                      //
// --------------------------------------------------------------------- //

export async function storeLoginToken(
  tokenHash: string,
  userId: string,
  expiresAt: string,
  grantedRole: Role,
): Promise<void> {
  const createdAt = new Date().toISOString();
  if (usingFile()) {
    const d = readFile();
    d.loginTokens.push({ tokenHash, userId, createdAt, expiresAt, usedAt: null, grantedRole });
    writeFile(d);
    return;
  }
  const s = await sql();
  await s.unsafe(
    `insert into login_tokens (token_hash, user_id, created_at, expires_at, granted_role)
     values ($1,$2,$3,$4,$5)`,
    [tokenHash, userId, createdAt, expiresAt, grantedRole],
  );
}

/** Consumes a login token, returning the user and the role that link grants. */
export async function consumeLoginToken(
  tokenHash: string,
): Promise<{ userId: string; grantedRole: Role } | null> {
  const now = new Date().toISOString();
  if (usingFile()) {
    const d = readFile();
    const t = d.loginTokens.find((x) => x.tokenHash === tokenHash);
    if (!t || t.usedAt || t.expiresAt < now) return null;
    t.usedAt = now;
    writeFile(d);
    return { userId: t.userId, grantedRole: (t.grantedRole as Role) ?? "investor" };
  }
  const s = await sql();
  const rows = await s.unsafe(
    `update login_tokens set used_at = $1
     where token_hash = $2 and used_at is null and expires_at > $1
     returning user_id, granted_role`,
    [now, tokenHash],
  );
  return rows.length ? { userId: rows[0].user_id, grantedRole: rows[0].granted_role ?? "investor" } : null;
}

/** Aligns the stored role with what the consumed link granted. */
export async function setUserRole(userId: string, role: Role): Promise<void> {
  if (usingFile()) {
    const d = readFile();
    const u = d.users.find((x) => x.id === userId);
    if (u) u.role = role;
    writeFile(d);
    return;
  }
  const s = await sql();
  await s.unsafe(`update users set role = $1 where id = $2`, [role, userId]);
}

export async function createSession(tokenHash: string, userId: string, expiresAt: string): Promise<void> {
  const createdAt = new Date().toISOString();
  if (usingFile()) {
    const d = readFile();
    d.sessions.push({ tokenHash, userId, createdAt, expiresAt });
    writeFile(d);
    return;
  }
  const s = await sql();
  await s.unsafe(
    `insert into sessions (token_hash, user_id, created_at, expires_at) values ($1,$2,$3,$4)
     on conflict (token_hash) do nothing`,
    [tokenHash, userId, createdAt, expiresAt],
  );
}

export async function userForSession(tokenHash: string): Promise<User | null> {
  const now = new Date().toISOString();
  if (usingFile()) {
    const d = readFile();
    const s = d.sessions.find((x) => x.tokenHash === tokenHash && x.expiresAt > now);
    return s ? (d.users.find((u) => u.id === s.userId) ?? null) : null;
  }
  const s = await sql();
  const rows = await s.unsafe(
    `select u.id, u.email, u.role, u.display_name, u.created_at, u.last_login_at
     from sessions se join users u on u.id = se.user_id
     where se.token_hash = $1 and se.expires_at > $2`,
    [tokenHash, now],
  );
  return rows.length ? rowToUser(rows[0]) : null;
}

export async function destroySession(tokenHash: string): Promise<void> {
  if (usingFile()) {
    const d = readFile();
    d.sessions = d.sessions.filter((x) => x.tokenHash !== tokenHash);
    writeFile(d);
    return;
  }
  const s = await sql();
  await s.unsafe(`delete from sessions where token_hash = $1`, [tokenHash]);
}

// --------------------------------------------------------------------- //
//                              Applications                             //
// --------------------------------------------------------------------- //

export async function listApplications(): Promise<Application[]> {
  if (usingFile()) {
    return readFile().applications.slice().sort((a, b) => a.reference.localeCompare(b.reference));
  }
  const s = await sql();
  const rows = await s.unsafe(`select ${APP_COLUMNS} from applications order by reference asc`);
  return rows.map(rowToApp);
}

export async function getApplication(id: string): Promise<Application | null> {
  if (usingFile()) return readFile().applications.find((a) => a.id === id) ?? null;
  const s = await sql();
  const rows = await s.unsafe(`select ${APP_COLUMNS} from applications where id = $1`, [id]);
  return rows.length ? rowToApp(rows[0]) : null;
}

export async function getApplicationByUser(userId: string): Promise<Application | null> {
  if (usingFile()) return readFile().applications.find((a) => a.userId === userId) ?? null;
  const s = await sql();
  const rows = await s.unsafe(`select ${APP_COLUMNS} from applications where user_id = $1 limit 1`, [userId]);
  return rows.length ? rowToApp(rows[0]) : null;
}

export async function getApplicationByWallet(wallet: string): Promise<Application | null> {
  const all = await listApplications();
  return all.find((a) => a.wallet.toLowerCase() === wallet.toLowerCase()) ?? null;
}

export async function insertApplications(apps: Application[]): Promise<void> {
  if (usingFile()) {
    const d = readFile();
    const existing = new Set(d.applications.map((a) => a.id));
    for (const a of apps) if (!existing.has(a.id)) d.applications.push(a);
    writeFile(d);
    return;
  }
  const s = await sql();
  const placeholders = APP_FIELDS.map((_, i) => `$${i + 1}`).join(",");
  for (const a of apps) {
    await s.unsafe(
      `insert into applications (${APP_COLUMNS}) values (${placeholders}) on conflict (id) do nothing`,
      APP_FIELDS.map(([camel]) => (a as any)[camel] ?? null),
    );
  }
}

export async function updateApplication(
  id: string,
  patch: Partial<Application>,
  actor: string,
  action = "updated",
): Promise<Application> {
  const now = new Date().toISOString();
  const changed = Object.keys(patch).filter((k) => k !== "id");

  if (usingFile()) {
    const d = readFile();
    const i = d.applications.findIndex((a) => a.id === id);
    if (i < 0) throw new Error(`No application ${id}`);
    d.applications[i] = { ...d.applications[i], ...patch, updatedAt: now };
    d.events.push({
      id: d.nextEventId++,
      applicationId: id,
      at: now,
      actor,
      action,
      detail: changed.length ? changed.join(", ") : null,
    });
    writeFile(d);
    return d.applications[i];
  }

  const s = await sql();
  const sets: string[] = [];
  const values: any[] = [];
  for (const [k, v] of Object.entries(patch)) {
    if (k === "id") continue;
    const col = CAMEL_TO_SNAKE.get(k as keyof Application);
    if (!col) continue;
    values.push(v);
    sets.push(`${col} = $${values.length}`);
  }
  values.push(now);
  sets.push(`updated_at = $${values.length}`);
  values.push(id);
  await s.unsafe(`update applications set ${sets.join(", ")} where id = $${values.length}`, values);
  await s.unsafe(
    `insert into application_events (application_id, at, actor, action, detail) values ($1,$2,$3,$4,$5)`,
    [id, now, actor, action, changed.length ? changed.join(", ") : null],
  );
  const updated = await getApplication(id);
  if (!updated) throw new Error(`No application ${id}`);
  return updated;
}

export async function setStatus(
  id: string,
  status: ApplicationStatus,
  actor: string,
  detail?: string,
): Promise<Application> {
  return updateApplication(id, { status }, actor, `status → ${status}${detail ? ` (${detail})` : ""}`);
}

export async function listEvents(applicationId: string, limit = 40): Promise<ApplicationEvent[]> {
  if (usingFile()) {
    return readFile()
      .events.filter((e) => e.applicationId === applicationId)
      .sort((a, b) => b.id - a.id)
      .slice(0, limit);
  }
  const s = await sql();
  const rows = await s.unsafe(
    `select id, application_id, at, actor, action, detail from application_events
     where application_id = $1 order by id desc limit $2`,
    [applicationId, limit],
  );
  return rows.map((r: any) => ({
    id: Number(r.id),
    applicationId: r.application_id,
    at: r.at,
    actor: r.actor,
    action: r.action,
    detail: r.detail,
  }));
}

/**
 * Allocates the next application reference.
 *
 * Uses a sequence on Postgres so simultaneous sign-ups cannot collide. The file driver keeps the
 * max()+1 approach, which is fine for single-process local development.
 */
export async function nextReference(): Promise<string> {
  if (usingFile()) {
    const all = await listApplications();
    const nums = all.map((a) => Number(a.reference.split("-").pop())).filter((n) => Number.isFinite(n));
    return `APP-2026-${String((nums.length ? Math.max(...nums) : 500) + 1).padStart(4, "0")}`;
  }
  const s = await sql();
  const rows = await s.unsafe(`select nextval('application_reference_seq') as n`);
  return `APP-2026-${String(Number(rows[0].n)).padStart(4, "0")}`;
}

/**
 * Cheap existence check.
 *
 * Seeding used to call listApplications() to decide whether it had anything to do, pulling every
 * row on every page load just to compare a length against zero. Against a database in another
 * region that is a full round trip and scan for no reason.
 */
export async function hasApplications(): Promise<boolean> {
  if (usingFile()) return readFile().applications.length > 0;
  const s = await sql();
  const rows = await s.unsafe(`select 1 from applications limit 1`);
  return rows.length > 0;
}

// --------------------------------------------------------------------- //
//                         Trade-tape order journal                       //
// --------------------------------------------------------------------- //

/** Shape mirrors lib/orders.ts OrderRecord; kept structural to avoid a circular import. */
type OrderRowShape = {
  id: string;
  at: string;
  who: string;
  direction: string;
  amountIn: string;
  inSymbol: string;
  outSymbol: string;
  received?: string;
  ok: boolean;
  reason?: string;
  txHash?: string;
};

export async function dbInsertOrder(o: OrderRowShape): Promise<void> {
  await ensureSchema();
  const s = await sql();
  await s`insert into demo_orders (id, at, who, direction, amount_in, in_symbol, out_symbol, received, ok, reason, tx_hash)
          values (${o.id}, ${o.at}, ${o.who}, ${o.direction}, ${o.amountIn}, ${o.inSymbol}, ${o.outSymbol},
                  ${o.received ?? null}, ${o.ok}, ${o.reason ?? null}, ${o.txHash ?? null})
          on conflict (id) do nothing`;
}

export async function dbListOrders(limit: number): Promise<OrderRowShape[]> {
  await ensureSchema();
  const s = await sql();
  const rows = await s`select * from demo_orders order by at desc limit ${limit}`;
  return rows.map((r: any) => ({
    id: r.id,
    at: r.at,
    who: r.who,
    direction: r.direction,
    amountIn: r.amount_in,
    inSymbol: r.in_symbol,
    outSymbol: r.out_symbol,
    received: r.received ?? undefined,
    ok: r.ok,
    reason: r.reason ?? undefined,
    txHash: r.tx_hash ?? undefined,
  }));
}

export async function dbClearOrders(): Promise<void> {
  await ensureSchema();
  const s = await sql();
  await s`delete from demo_orders`;
}
