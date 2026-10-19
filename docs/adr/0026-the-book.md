# 0026. The book

- **Status:** Accepted
- **Date:** 16 October 2026

## Context

An agency and trust desk runs a book of notes. It needs to see the whole book at once: what each
note needs next, what is running, and what waits for a second approver, without opening each note.

## Decision

**One page, first in the Agent's menu, one row a note, in series order:**
- the series and ISIN, the note, and its status: live, redeemed, closed or retired;
- units outstanding, and units in the Issuer's inventory;
- dates determined of the dates scheduled, and what it needs next: determine a date, or pay a
  date's coupon or redemption, marked when it is due by the chain's clock;
- what the desk has under way: proposals awaiting a second approver, jobs running, jobs failed.

**Totals head the page:** notes, live notes, units outstanding, acts due, proposals awaiting
approval, jobs running and jobs failed.

**Where it reads from:** balances, dates and distributions from the chain's current state; the
notes on record and retirements from the event index; the desk's work from the jobs. Every note the
factory issued is on it, whether issued from the site or by the deployment itself; a note the site
did not issue links to its reconciliation statement.

## Consequences

- The book's cost is one query of the index plus a few reads per note, whatever its size.
- What is due across the book is visible at a glance, and drives the desk's day.
