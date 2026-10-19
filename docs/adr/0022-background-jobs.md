# 0022. Background jobs

- **Status:** Accepted
- **Date:** 16 October 2026

## Context

Issuance and payment runs take many transactions, and on Ethereum Sepolia each can take minutes. A
run that advances only while a page polls it stops when the tab closes. A desk running many notes
needs runs that finish on their own, survive a crash, and can be stopped. The site runs on Vercel,
where nothing runs between requests and one request may run for at most five minutes.

## Decision

**Jobs live in the database.**
- A determination or a payment is a job row: its kind, its note, who proposed it, its approval,
  its state (awaiting approval, queued, done, failed, stopped), its last error and what it has
  sent. A note being issued is a row of its own, advanced step by step the same way (record 0009).
- **One worker per step.** A worker claims a step by the row's version before it runs it, so two
  workers never run the same step. A claim older than any request can last (six minutes) is
  released to run again.
- **Each step is worked out from the chain,** so running one again after a crash is safe.
- **A failed step waits before it runs again,** longer each time, up to a minute; after eight
  tries the job is marked failed with its reason, for staff to see.
- **Staff can stop a job** or an issuance. Whatever already reached the chain stays there.

**What carries jobs forward:**
- the server, after answering the request that started or nudged them (Next's `after()`), for up
  to its five minutes;
- every page load in any staff portal;
- a cron route, `/api/jobs/tick`, protected by `CRON_SECRET`. On Vercel's Hobby plan it runs once a
  day, at 06:00 UTC, as a backstop; on a plan that allows it, the schedule in `site/vercel.json`
  becomes every minute.

Every run also brings the event index up to date (record 0023).

| Option | Chosen? | Why |
|---|---|---|
| After the response, page loads, and cron | Yes | No page needs to stay open; a crashed run resumes at the next page load or cron; runs on Vercel with nothing extra |
| Vercel Workflow | No | Durable, but ties the desk to a platform product still maturing, and the local stack would need its runner too |
| Staff pages drive the run | No | A run stops when the tab closes |

## Consequences

- On the Hobby plan, a job whose server run ends waits for the next Agent page load, or at worst the
  daily cron. A plan with per-minute crons removes that wait with a one-line change.
- Pages show a job's progress from the database and never run its steps themselves.
- Scripts and tests run a job to its end in their own process, failing at once on a failed step.
