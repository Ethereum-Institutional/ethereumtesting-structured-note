# 0084. A close-out statement for a redeemed note, read from the chain

- **Status:** Accepted (owner, 2 October 2026)
- **Date:** 2 October 2026

## Context

The requirement ends "with full reconciliation confirming zero positions", and S-33 expects
closure to leave the supply at zero, the holder list empty, the suspense accounts drained, and a
full reconciliation confirming zero positions. A redeemed note's supply reached zero under test,
but nothing set out the evidence a reviewer would sign off on.

## Decision

For a note that has redeemed, its page shows a close-out statement, also downloadable as JSON for
the evidence pack. It is read from the chain alone, at one block, so anyone with the chain can
reproduce it.

**Its checks**, each passing or failing with its reason:
- the supply is zero;
- the note is redeemed: terminated and paused;
- the holder list is empty: every account the note ever moved to or from holds none, the Issuer's inventory included;
- every position reconciles: for each account, units received less units given up equals its balance;
- every distribution is paid in full;
- nothing is held for a holder;
- the Paying Agent and the settlement contract hold no cash;
- no offer is open, and no unit is locked.

**Its positions:** for each account, the units in and out, the coupons and redemption received, any amount still held, and the balance, with totals.

The statement says "Closed: every position is at zero" only when every check passes. Otherwise it names the checks that fail.

## Consequences

- An amount held for a holder whose grant has lapsed keeps the note from closing until it is claimed. The statement shows it, rather than calling the note closed.
- Tested:
  - an integration test: a four-date note, not closed before its dates, then closed with every figure reconciled after them;
  - browser spec `10-lifecycle`: a note redeemed with an unbound wallet's payments held, so not closed, with the two failing checks named and the JSON download read.
