# Onboarding store

The investor portal keeps applications in a real store, separate from the chain. Personal data
stays here; what reaches the chain is a claim carrying the application reference and a keccak
digest of the record.

## Drivers

Selected automatically, by environment variable:

| Condition | Driver | Durable? |
|---|---|---|
| `POSTGRES_URL` or `DATABASE_URL` set | Postgres | yes |
| Running on Vercel with neither set | file in `/tmp` | no — resets on cold start |
| Local dev with neither set | file in `dashboard/.data/` | yes, on your machine |

The portal labels which driver is live in its top-right corner, and says "resets on restart"
when the store is not durable. Nothing above `lib/db/index.ts` knows which is in use.

## Making it durable (Supabase)

One command, and it has to be you rather than an agent, because it records acceptance of the
Vercel Marketplace End User Addendum and Supabase's terms and privacy policy on the
OpenZeppelin team account:

```bash
cd dashboard
vercel integration add supabase --name apac-rwa-onboarding
```

That provisions the database, connects it to the project and pulls the connection string into
the project's environment as `POSTGRES_URL`. Then redeploy:

```bash
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
