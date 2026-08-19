/**
 * Drops and recreates the platform tables.
 *
 * ensureSchema() uses CREATE TABLE IF NOT EXISTS, which deliberately will not alter an existing
 * table — so a schema change needs this. The data is demo data and reseeds on the next request,
 * so dropping is the honest migration path here rather than hand-written ALTERs.
 *
 *   node --env-file=.env.local scripts/reset-db.mjs
 */
import postgres from "postgres";

const url = process.env.POSTGRES_URL ?? process.env.DATABASE_URL;
if (!url) {
  console.error("No POSTGRES_URL. Run with --env-file=.env.local");
  process.exit(1);
}

const sql = postgres(url, { ssl: "require", prepare: false, max: 1 });
try {
  await sql.unsafe(`
    drop table if exists application_events;
    drop table if exists applications;
    drop table if exists sessions;
    drop table if exists login_tokens;
    drop table if exists users;
  `);
  console.log("dropped platform tables — recreated and reseeded on the next request");
} finally {
  await sql.end();
}
