# Onboarding store

The investor portal keeps applications in a real store, separate from the chain. Personal data
stays here; what reaches the chain is a claim carrying the application reference and a keccak
digest of the record.

## Drivers

Selected automatically, by environment variable:

| Condition | Driver | Durable? |
|---|---|---|
| `POSTGRES_URL` or `DATABASE_URL` set | Postgres | yes |
| Running on Vercel with neither set | file in `/tmp` | no — resets on cold start (not the current setup) |
| Local dev with neither set | file in `dashboard/.data/` | yes, on your machine |

The portal labels which driver is live in its top-right corner, and says "resets on restart"
when the store is not durable. Nothing above `lib/db/index.ts` knows which is in use.

## Current state: Supabase, provisioned

Done. A Supabase Postgres database named `apac-rwa-onboarding` is provisioned under the
`vladestoup-3112s-projects` team, connected to the `apac-rwa-console` project, and its
connection string is set as `POSTGRES_URL` across production, preview and development. Both
portal pages report `store: postgres`.

Marketplace terms were accepted on 2026-08-19 (installation `icfg_zySJ7Apzh70N6PQI1sxIS7JU`):

- <https://vercel.com/legal/integration-marketplace-end-users-addendum>
- <https://supabase.com/terms>
- <https://supabase.com/privacy>

The dashboard is at
<https://vercel.com/d/dashboard/integrations/supabase/icfg_zySJ7Apzh70N6PQI1sxIS7JU>.

If you ever need to re-provision:

```bash
cd dashboard
vercel integration add supabase --name apac-rwa-onboarding
vercel deploy --prod --yes
```

The schema is created on first request — `ensureSchema()` runs the DDL in
`dashboard/lib/db/schema.sql`, which is idempotent. Seed data is inserted only when the table
is empty, and is derived from `ops/addresses.json` so every application maps to a wallet that
exists on the chain.

Policy links, for reference before you accept:

- <https://vercel.com/legal/integration-marketplace-end-users-addendum>
- <https://supabase.com/terms>
- <https://supabase.com/privacy>

Neon, Prisma Postgres or any other provider works identically — the driver only needs a
Postgres connection string. Swap `supabase` for `neon` in the command above.

## Schema

Two tables. `applications` holds the file; `application_events` records every change, which is
what lets the admin view show who touched a record and when. Without that second table the
compliance story is noticeably weaker.

## Local development

`vercel env pull` writes `dashboard/.env.local`, which includes the production `RPC_URL` —
the Cloudflare tunnel, not your local node. `dashboard/.env.development.local` overrides it
back to `http://127.0.0.1:8545` so local dev always talks to the local chain while still using
the real database. Both files are gitignored.

To reset the onboarding data to its opening state, drop the two tables and let the next request
reseed them:

```bash
cd dashboard
node -e "const p=require('postgres');const s=p(process.env.POSTGRES_URL,{ssl:'require'});\
s.unsafe('drop table if exists application_events; drop table if exists applications;')\
.then(()=>{console.log('dropped');return s.end()})" --env-file=.env.local
```
