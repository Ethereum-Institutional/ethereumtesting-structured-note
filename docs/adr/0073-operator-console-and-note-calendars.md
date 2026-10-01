# 0073. The Operator console in sections, "notes" without qualification, and a calendar configured by observations and interval

- **Status:** Accepted (owner, 1 October 2026)
- **Date:** 1 October 2026
- **Amends:** ADR 0072, decision 2 (the calendar) and its naming

## Context

The Operator page had grown to seven sections on one page. Notes issued from the site were called
demonstration notes, although on-chain they are notes like any other (ADR 0027). Their calendar
offered three fixed spacings of four observations, which could neither mirror a real note nor
match the time an audience has.

## Decision

- **The Operator console has a navigation column** and a page per section:
  - Access requests (`/operator`)
  - Clients (`/operator/clients`)
  - Custody: Custodial (`/operator/custody/custodial`) and Self-custody (`/operator/custody/self-custody`)
  - Admissions (`/operator/admissions`)
  - Notes (`/operator/notes`)
  - Audit log (`/operator/audit`)

  Each page loads only what it shows, and an action refreshes every page of the console.
- **They are notes.** Nothing a user sees calls them demonstration notes, or says that anything is
  a demonstration.
- **The calendar is configured, not chosen from a list.** Staff give:
  - the number of observations (coupon dates), from 1 to 12;
  - the time between them, in minutes, hours, days or calendar months.

  Each record time falls a fifth of the way to the next observation, and each payment two fifths,
  at most 2 and 5 days after the observation. A quarterly calendar therefore has the real note's
  lags, and a calendar of minutes stays inside its period. The form previews every date, the
  maturity and the note's whole life before issuing, and the server fixes the same dates from the
  block that fixes the terms. The life is at most ten years.
- **A scenario keeps its shape on any number of dates.** The scenario's first three dates set the
  pattern of the early dates, the last of them repeated if there are more, and its maturity is the
  last date. An early redemption still happens on its date, and the barrier is breached or not at
  maturity, as in the scenario. Only a four-date note matches the independent model's expected
  payments exactly, and the form says so when there are more or fewer.

## Consequences

- Links to the old single page now go to its section; the staff email for approvals goes to Admissions.
- Notes issued before this record four observations, a number of minutes apart, and are shown as such.
