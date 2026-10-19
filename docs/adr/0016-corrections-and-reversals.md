# 0016. Corrections and reversals

- **Status:** Accepted
- **Date:** 16 October 2026

## Context

A Calculation Agent can make a mistake, and a payment can go to the wrong holders. A wrong
determination must never be final, and a wrong payment must be corrected on the chain, holder by
holder, so that the chain and the Register agree again, with the original kept on record rather
than erased.

## Decision

**Reversing a coupon** (Tier 2, `ReverseDistribution`): for each holder named, the Paying Agent
takes back its original credit by a forced transfer on the deposit to the funder's account, with
the written reason emitted.
- A holder's amount is its balance at the original Record Time times the amount per Calculation
  Amount.
- What cannot be recovered from the holder's deposit balance is recorded as a shortfall, never
  hidden.
- An amount that was held for the holder and never paid is cancelled instead.
- Only a closed coupon reverses; a redemption, whose units are burned, never does.
- The original distribution stays on record, marked reversed once every holder paid is reversed.

**Restating** (Tier 2, `RestateDistribution`): a reversed coupon is paid again against a corrected
Record Time, as a new distribution paid in the ordinary way.

**Correcting a determination** (Tier 2, `CorrectDetermination`), at any time:
- The Calculation Agent signs the corrected Levels and outcome again. The Determination Agent
  replaces its latest determination, recomputed from the coupon count and breach as they stood
  before that date, and accepts it only if the outcome agrees. The note's termination follows the
  corrected outcome.
- Where that date's coupon was paid, the same act reverses it for the holders of record named and,
  where the corrected outcome pays a coupon, restates it at the corrected amount at the same
  Record Time.
- Refused while that date's coupon is still being paid, and once a redemption on it has opened.

| Option | Chosen? | Why |
|---|---|---|
| Correct at any time, through Tier 2, reversing and restating any payment | Yes | A wrong determination is never final, and the correction is visible on the chain |
| Correct only before payment | No | A wrong payment could not be corrected on the chain |
| Never correct | No | A Calculation Agent's error could not be fixed at all |
| Net corrections, or the Register alone | No | The chain would disagree with the Register in exactly the case a reviewer tests |

**On the site,** a correction is proposed on the Tier 2 page with the corrected Levels, which the
Calculation Agent's key signs, and, where the coupon was paid, every holder the Paying Agent paid
it to.

## Consequences

- History is restated, never rewritten: the original determination's event, the reversal and the
  restatement are all on the chain.
- Each Paying Agent holds the deposit's forced-transfer role, granted by the controller as it
  adopts the note, for reversals alone.
- A correction waits the Tier 2 delay like any intervention.
