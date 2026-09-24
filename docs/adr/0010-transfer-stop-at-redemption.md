# 0010. Stop transfers at a possible redemption's Record Time

- **Status:** Accepted (Wave 3, L2)
- **Date:** 24 September 2026

## Context

Spike 3, E4: after a redemption's Record Time a transfer would move units whose redemption
belongs to the seller, and the buyer's units would be burned unpaid.

## Options considered

| Option | Summary |
|---|---|
| Engine refuses, then pause | The record-date engine, called on every balance change, refuses ordinary transfers from the Record Time; opening the redemption pauses the note so the views agree. |
| Pause only | The Agent pauses at the Record Time. |
| Swap the gate | Point the note at a gate with a cut-off. |

## Decision

The engine refuses ordinary transfers from the Record Time, exactly at the timestamp, and opening
a redemption pauses the note. **Refined during the build:** an MER is known only once its date is
determined, so the stop applies from the Record Time of any date that could redeem, and lifts once
that date's determination shows no redemption.

## Why

The stop needs no transaction to land on time, so there is no window in which the harm E4 exists
to prevent can occur. A pause or a gate swap both depend on a timed transaction. The refinement is
the only way to honour E4 when the redemption is not known in advance.

## Consequences

- Until the pause lands, the views can say yes while a transfer refuses: the safe direction.
- A late determination pauses secondary trading rather than risking a transfer.
- Forced transfers are stopped too.
