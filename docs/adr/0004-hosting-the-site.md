# 0004. Hosting the site

- **Status:** Accepted
- **Date:** 16 October 2026

## Context

The site is a Next.js application that signs transactions for the desk and keeps registrations,
onboardings, notes, jobs and an event index. It must be reachable by the bank's people on one
public address, and must also run inside the bank's own environment.

## Decision

**On Vercel, at ethereumtesting.com:**
- The site is served at `https://structurednote-project.ethereumtesting.com`. Every app of the
  organisation lives on an ethereumtesting.com subdomain; the project's own `.vercel.app` address
  redirects there, and deployment protection stays on so per-deployment addresses are not public.
- `SITE_URL` is the only source of the origin written into mail, never the request's Host header.
- Production settings are Vercel environment variables of type *sensitive*. `ops/vercel-env.sh`
  sets the chain settings (RPC, manifest, signing keys) straight from the key and network files,
  printing names, never values.
- The project is on Vercel's Hobby plan: a request may run for five minutes and a cron may run
  once a day (record 0022).
- The site is deployed from the repository root, because its build copies the overview from
  `docs/`.

**As a container, for the bank's virtual machine.** `ops/vm/Dockerfile` builds the same code as a
standalone Next.js server. Keys, the manifest and every setting come in at run time
(`ops/vm/compose.yaml`, `ops/vm/vm-env.sh`), from the same list Vercel receives (`ops/site_env.py`).

**Storage.** Postgres when `POSTGRES_URL` or `DATABASE_URL` is set; the schema is applied on first
use. Without it, a JSON file under `.data/` serves local development only: in production the store
refuses to start without Postgres.

**Mail** goes through Resend, from the address in `MAIL_FROM`, on ethereumtesting.com. In production a missing mail
configuration is an error, so a sign-in code is never shown on screen instead of being sent.

**Records are scoped to a deployment.** A deployment is identified by its chain and its identity
storage's address. Onboardings, notes and indexed events are stamped with it and only the current
deployment's are read; earlier rows stay as history. Registrations, sessions, the bank's client
records and the audit log are the bank's, not a deployment's, and carry over.

**Headers.** A strict Content-Security-Policy, no framing, no referrer, `noindex`, and HSTS in
production.

## Consequences

- One public address for every reader, and mail that always points to it.
- Moving to a fresh deployment needs no database work: the site reads the new manifest and starts
  that deployment's records afresh.
- The bank can run the site itself with no change to its code.
