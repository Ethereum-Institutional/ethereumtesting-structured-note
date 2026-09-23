import "server-only";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import postgres from "postgres";

/**
 * Registrations, one-time links, sessions and the audit log.
 *
 * Postgres when POSTGRES_URL or DATABASE_URL is set. Otherwise a JSON file under .data/, which
 * exists for local development only: in production the store refuses to start without Postgres,
 * so a misconfigured deployment fails closed rather than keeping access state in ephemeral disk.
 *
 * Only hashes of link tokens and session identifiers are stored.
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

export interface Store {
  registrantByEmail(email: string): Promise<Registrant | null>;
  registrantById(id: string): Promise<Registrant | null>;
  createRegistrant(r: Registrant): Promise<void>;
  setStatus(id: string, status: Status, fields: Partial<Pick<Registrant, "verifiedAt" | "decidedAt" | "decidedBy">>): Promise<void>;
  listRegistrants(): Promise<Registrant[]>;

  putLink(hash: string, registrantId: string, expiresAt: string): Promise<void>;
  latestLinkAt(registrantId: string): Promise<string | null>;
  /** Marks the link used and returns its registrant, or null if absent, used or expired. Atomic. */
  consumeLink(hash: string, now: string): Promise<string | null>;
  /** Whether the link exists and is still usable, without consuming it. */
  linkUsable(hash: string, now: string): Promise<boolean>;

  putSession(hash: string, registrantId: string, expiresAt: string): Promise<void>;
  sessionRegistrant(hash: string, now: string): Promise<string | null>;
  deleteSession(hash: string): Promise<void>;
  deleteSessionsFor(registrantId: string): Promise<void>;

  audit(e: AuditEntry): Promise<void>;
  auditLog(limit: number): Promise<AuditEntry[]>;
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
create table if not exists links (
  hash text primary key,
  registrant_id text not null references registrants(id),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz
);
create index if not exists links_registrant on links(registrant_id, created_at desc);
create table if not exists sessions (
  hash text primary key,
  registrant_id text not null references registrants(id),
  expires_at timestamptz not null
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
    async putLink(hash, registrantId, expiresAt) {
      const s = await q();
      await s`insert into links (hash, registrant_id, expires_at) values (${hash}, ${registrantId}, ${expiresAt})`;
    },
    async latestLinkAt(registrantId) {
      const s = await q();
      const [r] = await s`select created_at from links where registrant_id = ${registrantId} order by created_at desc limit 1`;
      return r ? iso(r.created_at) : null;
    },
    async consumeLink(hash, now) {
      const s = await q();
      const [r] = await s`update links set used_at = ${now}
                          where hash = ${hash} and used_at is null and expires_at > ${now}
                          returning registrant_id`;
      return r ? (r.registrant_id as string) : null;
    },
    async linkUsable(hash, now) {
      const s = await q();
      const [r] = await s`select 1 from links where hash = ${hash} and used_at is null and expires_at > ${now}`;
      return Boolean(r);
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
  };
}

// --------------------------------------------------------------------------------------------
// File, development only
// --------------------------------------------------------------------------------------------

type FileData = {
  registrants: Registrant[];
  links: { hash: string; registrantId: string; createdAt: string; expiresAt: string; usedAt: string | null }[];
  sessions: { hash: string; registrantId: string; expiresAt: string }[];
  audit: AuditEntry[];
};

function fileStore(dir: string): Store {
  const path = join(dir, "store.json");
  const load = (): FileData => {
    try {
      return JSON.parse(readFileSync(path, "utf8"));
    } catch {
      return { registrants: [], links: [], sessions: [], audit: [] };
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
    async putLink(hash, registrantId, expiresAt) {
      edit((d) => void d.links.push({ hash, registrantId, createdAt: new Date().toISOString(), expiresAt, usedAt: null }));
    },
    async latestLinkAt(registrantId) {
      const l = load().links.filter((x) => x.registrantId === registrantId).map((x) => x.createdAt).sort();
      return l.at(-1) ?? null;
    },
    async consumeLink(hash, now) {
      return edit((d) => {
        const l = d.links.find((x) => x.hash === hash && !x.usedAt && x.expiresAt > now);
        if (!l) return null;
        l.usedAt = now;
        return l.registrantId;
      });
    },
    async linkUsable(hash, now) {
      return load().links.some((x) => x.hash === hash && !x.usedAt && x.expiresAt > now);
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
  };
}

// --------------------------------------------------------------------------------------------

let store: Store | null = null;

export function getStore(): Store {
  if (store) return store;
  const url = process.env.POSTGRES_URL ?? process.env.DATABASE_URL;
  if (url) return (store = postgresStore(url));
  if (process.env.NODE_ENV === "production" && !process.env.ALLOW_FILE_STORE) {
    throw new Error("No database configured. Set POSTGRES_URL. Refusing to hold access state on local disk.");
  }
  return (store = fileStore(join(process.cwd(), ".data")));
}
