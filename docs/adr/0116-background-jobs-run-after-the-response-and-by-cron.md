# 0116. Background jobs run after the response, and by cron

- **Status:** Accepted, for release 0.3.0 (workstream 8)
- **Date:** 16 October 2026

## Context

Issuance and payment runs take many transactions. On Ethereum Sepolia each can take minutes. Until
now a run advanced only while a staff page polled it, so closing the tab stopped it. One issuance
hung for an hour with no way to see why or stop it. A desk running many notes needs runs that
finish on their own, survive a crash, and never send two transactions with the same key at once.

The site runs on Vercel, where nothing runs between requests, and one request may run for at most
five minutes.

## Decision

- **Jobs live in the database.** Each job is a row holding its kind, its subject (a note, a date's
  payment), its next step, its state and its last error. A step is claimed under a lease before it
  runs, so two workers never run the same step, and a lease older than any request can last is
  released to run again.
- **One sender per key.** A key's transactions are sent under a lease held in the database, one at a
  time, each waiting for its receipt, across every server instance.
- **What carries a job forward:**
  - Starting or advancing a job continues on the server after the page has its answer (Next's
    `after()`), for up to five minutes.
  - Any staff page load also carries the queue on.
  - A cron route picks up any job with work left. The project is on Vercel's Hobby plan, which
    allows a cron once a day, so it runs daily at 06:00 UTC as a backstop; on a plan that allows
    it, the schedule becomes every minute.
- **Staff can stop a job.** Whatever already reached the chain stays there.

| Option | Chosen? | Why |
|---|---|---|
| After-response and cron | Yes | No page needs to stay open; a crashed run resumes at the next page load or cron; runs on Vercel with nothing extra |
| Vercel Workflow | No | Durable, but ties the desk to a platform product still maturing, and the local stack would need its runner too |
| Staff pages drive the run | No | A run stops when the tab closes: the failure seen on Ethereum Sepolia |

## Consequences

- On the Hobby plan, a job whose server run ends (after five minutes, or a crash) waits for the
  next staff page load, or at worst the daily cron. Moving to a plan with per-minute crons removes
  that wait with a one-line change to `site/vercel.json`.
- The cron route is protected by a secret, so it cannot be called from outside.
- Pages show a job's progress from the database, and no longer run its steps themselves.
