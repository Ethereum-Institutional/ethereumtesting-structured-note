import "server-only";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import postgres from "postgres";
import { loadManifest } from "./chain/manifest.ts";

/**
 * Registrations, one-time sign-in codes, sessions and the audit log.
 *
 * Postgres when POSTGRES_URL or DATABASE_URL is set. Otherwise a JSON file under .data/, which
 * exists for local development only: in production the store refuses to start without Postgres,
 * so a misconfigured deployment fails closed rather than keeping access state in ephemeral disk.
 *
 * Only salted hashes of sign-in codes, and hashes of session identifiers, are stored.
 */

export type Status = "unverified" | "pending" | "approved" | "revoked";

export type Registrant = {
  id: string;
  email: string;
  name: string;
  organisation: string;
  status: Status;
  createdAt: string;
  verifiedAt: string | null;
  decidedAt: string | null;
  decidedBy: string | null;
};

export type AuditEntry = { at: string; actor: string; action: string; subject: string };

/**
 * A participant's onboarding (ADR 0089): its custody route, its wallet and identity, the claims
 * each institution added, and its request for the note and the decision on it. The table keeps
 * its earlier name, `admissions`, so placement and the Ledger read it as before.
 */
export type AdmissionStatus =
  | "requested"
  | "awaiting-wallet"
  | "awaiting-custodian"
  | "onboarded"
  | "declined"
  | "cancelled"
  | "offboarded"
  | "failed";

/** How the participant holds its wallet (ADR 0089). */
export type AdmissionRoute = "bank-custody" | "third-party" | "self-custody" | "existing-identity";

export type Admission = {
  id: string;
  registrantId: string;
  route: AdmissionRoute;
  status: AdmissionStatus;
  createdAt: string;
  /** Unused since 0.2.0; kept so the table's columns are unchanged. */
  officerRequestId: string | null;
  walletRequestId: string | null;
  data: Record<string, unknown>;
};

/**
 * A corporate client as the bank's onboarding records it (ADR 0089): the facts staff entered once,
 * kept here in the bank's portal and nowhere else, with the salt and hash a claim carries.
 */
export type Client = {
  id: string;
  /** The bank's own reference for the client. */
  kycReference: string;
  /** The facts, as staff entered and the bank verified them. */
  claims: Record<string, unknown>;
  /** The record's salt and its hash, which the bank's claim carries (ADR 0088, Q1). */
  salt: `0x${string}`;
  recordHash: `0x${string}`;
  /** When the facts were last verified: the client's screening date. */
  issuedAt: string;
  issuedBy: string;
  createdAt: string;
  /** Earlier records for the same client, superseded by a re-screen. */
  previous: Array<{ recordHash: string; issuedAt: string }>;
  /** The client asked, from Onboard, for its account to be held in custody (ADR 0076). */
  custodyRequest?: { registrantId: string; email: string; at: string };
};

/** A note issued from the site (ADRs 0072, 0073): its terms, its contracts as they are deployed, and its life. */
export type DemoNote = {
  id: string;
  series: number;
  name: string;
  symbol: string;
  scenario: string;
  /** Notes issued before ADR 0073: minutes between four observations. */
  spacingMinutes?: number;
  observations?: number;
  interval?: { value: number; unit: "minutes" | "hours" | "days" | "months" };
  units: number;
  status: "issuing" | "issued" | "failed" | "closed";
  /** The next issuance step to run; issuance is a sequence of single transactions. */
  step: number;
  createdAt: string;
  by: string;
  error?: string;
  addresses: Record<string, string>;
  txs: Record<string, string>;
  /** Unix seconds of each observation, record time and payment time, fixed when the terms are. */
  calendar?: Array<{ date: number; recordTime: number; paymentDate: number }>;
  data: Record<string, unknown>;
};

export interface Store {
  registrantByEmail(email: string): Promise<Registrant | null>;
  registrantById(id: string): Promise<Registrant | null>;
  createRegistrant(r: Registrant): Promise<void>;
  setStatus(id: string, status: Status, fields: Partial<Pick<Registrant, "verifiedAt" | "decidedAt" | "decidedBy">>): Promise<void>;
  listRegistrants(): Promise<Registrant[]>;

  putCode(c: { id: string; registrantId: string; salt: string; hash: string; expiresAt: string }): Promise<void>;
  latestCodeAt(registrantId: string): Promise<string | null>;
  /** The registrant's newest code, if it is neither used, spent nor expired. */
  activeCode(registrantId: string, now: string): Promise<{ id: string; salt: string; hash: string; attempts: number } | null>;
  /** Marks a still-active code used; true when this call used it, so a code works once. Atomic. */
  useCode(id: string, now: string): Promise<boolean>;
  /** Counts a wrong attempt on a code, and spends it once the attempts reach `max`. */
  failCode(id: string, max: number, now: string): Promise<void>;

  putSession(hash: string, registrantId: string, expiresAt: string): Promise<void>;
  sessionRegistrant(hash: string, now: string): Promise<string | null>;
  deleteSession(hash: string): Promise<void>;
  deleteSessionsFor(registrantId: string): Promise<void>;

  audit(e: AuditEntry): Promise<void>;
  auditLog(limit: number): Promise<AuditEntry[]>;

  putAdmission(a: Admission): Promise<void>;
  admissionById(id: string): Promise<Admission | null>;
  /** The admission a verifier request belongs to, by either of its request identifiers. */
  admissionByRequest(requestId: string): Promise<Admission | null>;
  /** Replaces the admission, only if its status is still `expected`. Returns whether it did. */
  updateAdmission(a: Admission, expected: AdmissionStatus): Promise<boolean>;
  listAdmissions(limit: number): Promise<Admission[]>;
  /** The registrant's newest admission, on the given routes only when named. */
  latestAdmissionFor(registrantId: string, routes?: AdmissionRoute[]): Promise<Admission | null>;
  /** Every admission the registrant started, newest first. */
  admissionsFor(registrantId: string): Promise<Admission[]>;

  putClient(c: Client): Promise<void>;
  updateClient(c: Client): Promise<void>;
  clientById(id: string): Promise<Client | null>;
  clientByReference(kycReference: string): Promise<Client | null>;
  listClients(): Promise<Client[]>;

  putNote(n: DemoNote): Promise<void>;
  /** Replaces the note, only if its next step is still `expectedStep`. Returns whether it did. */
  updateNote(n: DemoNote, expectedStep: number): Promise<boolean>;
  noteById(id: string): Promise<DemoNote | null>;
  listNotes(): Promise<DemoNote[]>;
}

// --------------------------------------------------------------------------------------------
// Postgres
// --------------------------------------------------------------------------------------------

const DDL = `
create table if not exists registrants (
  id text primary key,
  email text not null unique,
  name text not null,
  organisation text not null,
  status text not null check (status in ('unverified','pending','approved','revoked')),
  created_at timestamptz not null,
  verified_at timestamptz,
  decided_at timestamptz,
  decided_by text
);
create table if not exists codes (
  id text primary key,
  registrant_id text not null references registrants(id),
  salt text not null,
  hash text not null,
  attempts integer not null default 0,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz
);
create index if not exists codes_registrant on codes(registrant_id, created_at desc);
create table if not exists sessions (
  hash text primary key,
  registrant_id text not null references registrants(id),
  expires_at timestamptz not null
);
create table if not exists notes (
  id text primary key,
  created_at timestamptz not null,
  step integer not null,
  data jsonb not null
);
create table if not exists clients (
  id text primary key,
  kyc_reference text not null unique,
  created_at timestamptz not null,
  data jsonb not null
);
create table if not exists admissions (
  id text primary key,
  registrant_id text not null references registrants(id),
  route text not null,
  status text not null,
  created_at timestamptz not null,
  officer_request_id text unique,
  wallet_request_id text unique,
  data jsonb not null
);
create table if not exists audit (
  id bigserial primary key,
  at timestamptz not null,
  actor text not null,
  action text not null,
  subject text not null
);
`;

type Row = Record<string, unknown>;
const iso = (v: unknown) => (v == null ? null : new Date(v as string).toISOString());
const toRegistrant = (r: Row): Registrant => ({
  id: r.id as string,
  email: r.email as string,
  name: r.name as string,
  organisation: r.organisation as string,
  status: r.status as Status,
  createdAt: iso(r.created_at)!,
  verifiedAt: iso(r.verified_at),
  decidedAt: iso(r.decided_at),
  decidedBy: (r.decided_by as string) ?? null,
});

const toAdmission = (r: Row): Admission => ({
  id: r.id as string,
  registrantId: r.registrant_id as string,
  route: r.route as AdmissionRoute,
  status: r.status as AdmissionStatus,
  createdAt: iso(r.created_at)!,
  officerRequestId: (r.officer_request_id as string) ?? null,
  walletRequestId: (r.wallet_request_id as string) ?? null,
  data: (typeof r.data === "string" ? JSON.parse(r.data) : r.data) as Record<string, unknown>,
});

function postgresStore(url: string): Store {
  const sql = postgres(url, { max: 3, prepare: false });
  let ready: Promise<unknown> | null = null;
  const q = async () => {
    ready ??= sql.unsafe(DDL);
    await ready;
    return sql;
  };
  return {
    async registrantByEmail(email) {
      const s = await q();
      const [r] = await s`select * from registrants where email = ${email}`;
      return r ? toRegistrant(r) : null;
    },
    async registrantById(id) {
      const s = await q();
      const [r] = await s`select * from registrants where id = ${id}`;
      return r ? toRegistrant(r) : null;
    },
    async createRegistrant(r) {
      const s = await q();
      await s`insert into registrants (id, email, name, organisation, status, created_at)
              values (${r.id}, ${r.email}, ${r.name}, ${r.organisation}, ${r.status}, ${r.createdAt})
              on conflict (email) do nothing`;
    },
    async setStatus(id, status, f) {
      const s = await q();
      await s`update registrants set status = ${status},
                verified_at = coalesce(${f.verifiedAt ?? null}, verified_at),
                decided_at = coalesce(${f.decidedAt ?? null}, decided_at),
                decided_by = coalesce(${f.decidedBy ?? null}, decided_by)
              where id = ${id}`;
    },
    async listRegistrants() {
      const s = await q();
      return (await s`select * from registrants order by created_at desc`).map(toRegistrant);
    },
    async putCode(c) {
      const s = await q();
      await s`insert into codes (id, registrant_id, salt, hash, expires_at) values (${c.id}, ${c.registrantId}, ${c.salt}, ${c.hash}, ${c.expiresAt})`;
    },
    async latestCodeAt(registrantId) {
      const s = await q();
      const [r] = await s`select created_at from codes where registrant_id = ${registrantId} order by created_at desc limit 1`;
      return r ? iso(r.created_at) : null;
    },
    async activeCode(registrantId, now) {
      const s = await q();
      // Only the newest code counts: asking for a new one retires the one before.
      const [r] = await s`select id, salt, hash, attempts, used_at, expires_at from codes
                          where registrant_id = ${registrantId} order by created_at desc limit 1`;
      if (!r || r.used_at || iso(r.expires_at)! <= now) return null;
      return { id: r.id as string, salt: r.salt as string, hash: r.hash as string, attempts: Number(r.attempts) };
    },
    async useCode(id, now) {
      const s = await q();
      const [r] = await s`update codes set used_at = ${now} where id = ${id} and used_at is null and expires_at > ${now} returning id`;
      return Boolean(r);
    },
    async failCode(id, max, now) {
      const s = await q();
      await s`update codes set attempts = attempts + 1,
                               used_at = case when attempts + 1 >= ${max} then ${now}::timestamptz else used_at end
              where id = ${id} and used_at is null`;
    },
    async putSession(hash, registrantId, expiresAt) {
      const s = await q();
      await s`insert into sessions (hash, registrant_id, expires_at) values (${hash}, ${registrantId}, ${expiresAt})`;
    },
    async sessionRegistrant(hash, now) {
      const s = await q();
      const [r] = await s`select registrant_id from sessions where hash = ${hash} and expires_at > ${now}`;
      return r ? (r.registrant_id as string) : null;
    },
    async deleteSession(hash) {
      const s = await q();
      await s`delete from sessions where hash = ${hash}`;
    },
    async deleteSessionsFor(registrantId) {
      const s = await q();
      await s`delete from sessions where registrant_id = ${registrantId}`;
    },
    async audit(e) {
      const s = await q();
      await s`insert into audit (at, actor, action, subject) values (${e.at}, ${e.actor}, ${e.action}, ${e.subject})`;
    },
    async auditLog(limit) {
      const s = await q();
      return (await s`select at, actor, action, subject from audit order by id desc limit ${limit}`).map((r) => ({
        at: iso(r.at)!,
        actor: r.actor as string,
        action: r.action as string,
        subject: r.subject as string,
      }));
    },
    async putAdmission(a) {
      const s = await q();
      await s`insert into admissions (id, registrant_id, route, status, created_at, officer_request_id, wallet_request_id, data)
              values (${a.id}, ${a.registrantId}, ${a.route}, ${a.status}, ${a.createdAt}, ${a.officerRequestId}, ${a.walletRequestId}, ${s.json(a.data as any)})`;
    },
    async admissionById(id) {
      const s = await q();
      const [r] = await s`select * from admissions where id = ${id}`;
      return r ? toAdmission(r) : null;
    },
    async admissionByRequest(requestId) {
      const s = await q();
      const [r] = await s`select * from admissions where officer_request_id = ${requestId} or wallet_request_id = ${requestId}`;
      return r ? toAdmission(r) : null;
    },
    async updateAdmission(a, expected) {
      const s = await q();
      const rows = await s`update admissions set status = ${a.status}, wallet_request_id = ${a.walletRequestId}, data = ${s.json(a.data as any)}
                           where id = ${a.id} and status = ${expected} returning id`;
      return rows.length === 1;
    },
    async listAdmissions(limit) {
      const s = await q();
      return (await s`select * from admissions order by created_at desc limit ${limit}`).map(toAdmission);
    },
    async latestAdmissionFor(registrantId, routes) {
      const s = await q();
      const [r] = routes
        ? await s`select * from admissions where registrant_id = ${registrantId} and route = any(${routes}) order by created_at desc limit 1`
        : await s`select * from admissions where registrant_id = ${registrantId} order by created_at desc limit 1`;
      return r ? toAdmission(r) : null;
    },
    async admissionsFor(registrantId) {
      const s = await q();
      return (await s`select * from admissions where registrant_id = ${registrantId} order by created_at desc limit 100`).map(toAdmission);
    },
    async putNote(n) {
      const s = await q();
      await s`insert into notes (id, created_at, step, data) values (${n.id}, ${n.createdAt}, ${n.step}, ${s.json(n as any)})`;
    },
    async updateNote(n, expectedStep) {
      const s = await q();
      const rows = await s`update notes set step = ${n.step}, data = ${s.json(n as any)} where id = ${n.id} and step = ${expectedStep} returning id`;
      return rows.length === 1;
    },
    async noteById(id) {
      const s = await q();
      const [r] = await s`select data from notes where id = ${id}`;
      return r ? (toJson(r.data) as DemoNote) : null;
    },
    async listNotes() {
      const s = await q();
      return (await s`select data from notes order by created_at desc`).map((r) => toJson(r.data) as DemoNote);
    },
    async putClient(c) {
      const s = await q();
      await s`insert into clients (id, kyc_reference, created_at, data) values (${c.id}, ${c.kycReference}, ${c.createdAt}, ${s.json(c as any)})`;
    },
    async updateClient(c) {
      const s = await q();
      await s`update clients set data = ${s.json(c as any)} where id = ${c.id}`;
    },
    async clientById(id) {
      const s = await q();
      const [r] = await s`select data from clients where id = ${id}`;
      return r ? (toJson(r.data) as Client) : null;
    },
    async clientByReference(kycReference) {
      const s = await q();
      const [r] = await s`select data from clients where kyc_reference = ${kycReference}`;
      return r ? (toJson(r.data) as Client) : null;
    },
    async listClients() {
      const s = await q();
      return (await s`select data from clients order by created_at desc`).map((r) => toJson(r.data) as Client);
    },
  };
}

const toJson = (v: unknown) => (typeof v === "string" ? JSON.parse(v) : v);

// --------------------------------------------------------------------------------------------
// File, development only
// --------------------------------------------------------------------------------------------

type FileData = {
  registrants: Registrant[];
  codes?: { id: string; registrantId: string; salt: string; hash: string; attempts: number; createdAt: string; expiresAt: string; usedAt: string | null }[];
  sessions: { hash: string; registrantId: string; expiresAt: string }[];
  audit: AuditEntry[];
  admissions?: Admission[];
  clients?: Client[];
  notes?: DemoNote[];
};

function fileStore(dir: string): Store {
  const path = join(dir, "store.json");
  const load = (): FileData => {
    try {
      return JSON.parse(readFileSync(path, "utf8"));
    } catch {
      return { registrants: [], codes: [], sessions: [], audit: [] };
    }
  };
  const save = (d: FileData) => {
    mkdirSync(dir, { recursive: true });
    writeFileSync(`${path}.tmp`, JSON.stringify(d, null, 1));
    renameSync(`${path}.tmp`, path);
  };
  const edit = <T>(f: (d: FileData) => T): T => {
    const d = load();
    const out = f(d);
    save(d);
    return out;
  };
  return {
    async registrantByEmail(email) {
      return load().registrants.find((r) => r.email === email) ?? null;
    },
    async registrantById(id) {
      return load().registrants.find((r) => r.id === id) ?? null;
    },
    async createRegistrant(r) {
      edit((d) => {
        if (!d.registrants.some((x) => x.email === r.email)) d.registrants.push(r);
      });
    },
    async setStatus(id, status, f) {
      edit((d) => {
        const r = d.registrants.find((x) => x.id === id);
        if (r) Object.assign(r, { status }, Object.fromEntries(Object.entries(f).filter(([, v]) => v != null)));
      });
    },
    async listRegistrants() {
      return [...load().registrants].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    },
    async putCode(c) {
      edit((d) => void (d.codes ??= []).push({ ...c, attempts: 0, createdAt: new Date().toISOString(), usedAt: null }));
    },
    async latestCodeAt(registrantId) {
      const l = (load().codes ?? []).filter((x) => x.registrantId === registrantId).map((x) => x.createdAt).sort();
      return l.at(-1) ?? null;
    },
    async activeCode(registrantId, now) {
      // Only the newest code counts: asking for a new one retires the one before.
      const c = (load().codes ?? []).filter((x) => x.registrantId === registrantId).sort((a, b) => a.createdAt.localeCompare(b.createdAt)).at(-1);
      if (!c || c.usedAt || c.expiresAt <= now) return null;
      return { id: c.id, salt: c.salt, hash: c.hash, attempts: c.attempts };
    },
    async useCode(id, now) {
      return edit((d) => {
        const c = (d.codes ?? []).find((x) => x.id === id && !x.usedAt && x.expiresAt > now);
        if (!c) return false;
        c.usedAt = now;
        return true;
      });
    },
    async failCode(id, max, now) {
      edit((d) => {
        const c = (d.codes ?? []).find((x) => x.id === id && !x.usedAt);
        if (!c) return;
        c.attempts += 1;
        if (c.attempts >= max) c.usedAt = now;
      });
    },
    async putSession(hash, registrantId, expiresAt) {
      edit((d) => void d.sessions.push({ hash, registrantId, expiresAt }));
    },
    async sessionRegistrant(hash, now) {
      return load().sessions.find((s) => s.hash === hash && s.expiresAt > now)?.registrantId ?? null;
    },
    async deleteSession(hash) {
      edit((d) => void (d.sessions = d.sessions.filter((s) => s.hash !== hash)));
    },
    async deleteSessionsFor(registrantId) {
      edit((d) => void (d.sessions = d.sessions.filter((s) => s.registrantId !== registrantId)));
    },
    async audit(e) {
      edit((d) => void d.audit.push(e));
    },
    async auditLog(limit) {
      return load().audit.slice(-limit).reverse();
    },
    async putAdmission(a) {
      edit((d) => void (d.admissions ??= []).push(a));
    },
    async admissionById(id) {
      return load().admissions?.find((a) => a.id === id) ?? null;
    },
    async admissionByRequest(requestId) {
      return load().admissions?.find((a) => a.officerRequestId === requestId || a.walletRequestId === requestId) ?? null;
    },
    async updateAdmission(a, expected) {
      return edit((d) => {
        const i = (d.admissions ?? []).findIndex((x) => x.id === a.id && x.status === expected);
        if (i < 0) return false;
        d.admissions![i] = a;
        return true;
      });
    },
    async listAdmissions(limit) {
      return [...(load().admissions ?? [])].sort((x, y) => y.createdAt.localeCompare(x.createdAt)).slice(0, limit);
    },
    async latestAdmissionFor(registrantId, routes) {
      return [...(load().admissions ?? [])]
        .filter((a) => a.registrantId === registrantId && (!routes || routes.includes(a.route)))
        .sort((x, y) => y.createdAt.localeCompare(x.createdAt))[0] ?? null;
    },
    async admissionsFor(registrantId) {
      return [...(load().admissions ?? [])].filter((a) => a.registrantId === registrantId).sort((x, y) => y.createdAt.localeCompare(x.createdAt));
    },
    async putNote(n) {
      edit((d) => {
        d.notes = [...(d.notes ?? []), n];
      });
    },
    async updateNote(n, expectedStep) {
      return edit((d) => {
        const i = (d.notes ?? []).findIndex((x) => x.id === n.id && x.step === expectedStep);
        if (i < 0) return false;
        d.notes![i] = n;
        return true;
      });
    },
    async noteById(id) {
      return (load().notes ?? []).find((n) => n.id === id) ?? null;
    },
    async listNotes() {
      return [...(load().notes ?? [])].sort((x, y) => y.createdAt.localeCompare(x.createdAt));
    },
    async putClient(c) {
      edit((d) => {
        if ((d.clients ?? []).some((x) => x.kycReference === c.kycReference)) throw new Error(`a client with reference ${c.kycReference} already exists`);
        d.clients = [...(d.clients ?? []), c];
      });
    },
    async updateClient(c) {
      edit((d) => {
        d.clients = (d.clients ?? []).map((x) => (x.id === c.id ? c : x));
      });
    },
    async clientById(id) {
      return (load().clients ?? []).find((c) => c.id === id) ?? null;
    },
    async clientByReference(kycReference) {
      return (load().clients ?? []).find((c) => c.kycReference === kycReference) ?? null;
    },
    async listClients() {
      return [...(load().clients ?? [])].sort((x, y) => y.createdAt.localeCompare(x.createdAt));
    },
  };
}

// --------------------------------------------------------------------------------------------

let store: Store | null = null;

export function getStore(): Store {
  if (store) return store;
  const url = process.env.POSTGRES_URL ?? process.env.DATABASE_URL;
  if (url) return (store = scopedToDeployment(postgresStore(url)));
  if (process.env.NODE_ENV === "production" && !process.env.ALLOW_FILE_STORE) {
    throw new Error("No database configured. Set POSTGRES_URL. Refusing to hold access state on local disk.");
  }
  // FILE_STORE_DIR lets the browser tests keep a fresh store away from the development one.
  return (store = scopedToDeployment(fileStore(process.env.FILE_STORE_DIR || join(process.cwd(), ".data"))));
}

// --------------------------------------------------------------------------------------------
// One deployment at a time (ADR 0083)
// --------------------------------------------------------------------------------------------

/**
 * The deployment the site runs against: its chain and its identity storage, which every deployment
 * has its own of (ADRs 0083, 0088). Null where no manifest is configured, when nothing is scoped.
 */
export function currentDeployment(): string | null {
  try {
    const m = loadManifest();
    const registry = m.identity?.identityStorage;
    return registry ? `${m.chainId}:${registry.toLowerCase()}` : null;
  } catch {
    return null;
  }
}

/**
 * Admissions and notes belong to the deployment whose contracts they act on (ADR 0083). Each is
 * stamped with it when written, and only the current deployment's are read; a row with no stamp
 * belongs to an earlier deployment. The rows stay in the store as history. Registrants, sessions,
 * clients (the bank's KYB) and the audit log are the bank's, not a deployment's, and carry over.
 */
function scopedToDeployment(inner: Store): Store {
  const here = currentDeployment();
  if (!here) return inner;
  const ours = (d: Record<string, unknown> | undefined) => d?.deployment === here;
  const stampA = (a: Admission): Admission => ({ ...a, data: { ...a.data, deployment: here } });
  const stampN = (n: DemoNote): DemoNote => ({ ...n, data: { ...n.data, deployment: here } });
  const onlyA = (a: Admission | null) => (a && ours(a.data) ? a : null);
  return {
    ...inner,
    putAdmission: (a) => inner.putAdmission(stampA(a)),
    updateAdmission: (a, expected) => inner.updateAdmission(stampA(a), expected),
    admissionById: async (id) => onlyA(await inner.admissionById(id)),
    admissionByRequest: async (id) => onlyA(await inner.admissionByRequest(id)),
    // Earlier deployments' rows are filtered after reading, so read past them.
    listAdmissions: async (limit) => (await inner.listAdmissions(limit + 1000)).filter((a) => ours(a.data)).slice(0, limit),
    admissionsFor: async (registrantId) => (await inner.admissionsFor(registrantId)).filter((a) => ours(a.data)),
    latestAdmissionFor: async (registrantId, routes) =>
      (await inner.admissionsFor(registrantId)).find((a) => ours(a.data) && (!routes || routes.includes(a.route))) ?? null,
    putNote: (n) => inner.putNote(stampN(n)),
    updateNote: (n, expectedStep) => inner.updateNote(stampN(n), expectedStep),
    noteById: async (id) => {
      const n = await inner.noteById(id);
      return n && ours(n.data) ? n : null;
    },
    listNotes: async () => (await inner.listNotes()).filter((n) => ours(n.data)),
  };
}
