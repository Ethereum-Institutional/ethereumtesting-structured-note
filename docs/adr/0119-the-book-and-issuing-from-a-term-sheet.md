# 0119. The book, and issuing from a term sheet

- **Status:** Accepted, for release 0.3.0 (workstreams 9 and 10)
- **Date:** 16 October 2026

## Context

An agency and trust desk runs a book of notes. It needs to see the whole book at once: what each
note needs next, what is running, and what waits for a second approver. It also issues each note
from the term sheet the Issuer agreed, with its ISIN, not from a template of demonstration terms.

## Decision

**The book.** One page, first in the Agent's menu, one row a note, in series order:

- the series and ISIN, the note, and its status: live, redeemed, closed or retired;
- units outstanding, and those in the Issuer's inventory;
- dates determined, and what it needs next: determine a date, or pay a date's coupon or
  redemption, marked when it is due;
- what the desk has under way: proposals awaiting a second approver, jobs running, jobs failed.

Totals across the book head the page. Balances and dates are read from the chain's current state,
retirements from the event index (ADR 0117), and the desk's work from the jobs (ADRs 0116, 0118).

**Issuing from a term sheet.** Staff upload or paste the note's term sheet as a record, in the form
the site publishes term sheets (`structured-note-term-sheet/1`). Before anything is sent it is
checked: every field present or explicitly not applicable, this network, the ISIN's check digit,
the first Record Time still to come, and the symbol and ISIN not already used. The record is then
the note's terms, name, symbol, issue size, ISIN and calendar, and is published as uploaded, at the
hash the note's identity carries. Issuance then runs as a background job.

Demonstration notes from a scenario remain, for showing a lifecycle quickly; their term sheet now
carries the ISIN given.

**Levels with their source.** A determination records where its Levels came from, with the
Levels, for the second approver to check (ADR 0118).

## Consequences

- The site never edits an uploaded record: what is published is what was uploaded, so the note's
  identity points to the Issuer's own document.
- An uploaded note has no payoff model to check its outcomes against; only demonstration notes do.
