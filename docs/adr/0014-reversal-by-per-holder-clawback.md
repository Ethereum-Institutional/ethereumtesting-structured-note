# 0014. Reversal is a per-holder clawback, then restatement

- **Status:** Accepted (built in Wave 4)
- **Date:** 24 September 2026

## Context

The overview's worked example: a coupon paid to holders on the 23rd when the terms say the 25th.
Record Times now come from the calendar fixed on-chain at issuance, so an instruction cannot carry
the wrong date; the example still arises if the calendar itself was entered wrongly.

## Options considered

| Option | Summary |
|---|---|
| Per-holder clawback, then restate | Tier 2 with a written reason, quorum and timelock; each holder's credit reversed by a reason-carrying forced transfer on the deposit; the original stays on the ledger, marked reversed; a second proposal restates. |
| Net correction | Pay those who should have been paid; recover overpayments off-chain. |
| Correct the Register only | Fix the Register; leave the chain. |

## Decision

Reverse holder by holder against the original credit under Tier 2, keep the original marked reversed, and restate by a second proposal.

## Why

It is the signed-off overview's design and keeps on-chain state evidence of the Register (D7).
History is restated rather than erased. Net correction and Register-only correction both leave the
chain disagreeing with the Register in precisely the case a reviewer will test.

## Consequences

- Forced transfer on the deposit goes to the Wave 4 controller.
- A holder without enough deposit left is recorded as a per-holder shortfall.
- The Paying Agent's per-holder settlement records are what a reversal targets.
- **Built in Wave 4, with one limit taken during the build:** only coupons can be reversed. A
  redemption has burned its units, so reversing one would mean re-issuing them, which is a
  notional amendment, not a reversal. A mistaken redemption is corrected by amending the notional
  and paying through a new distribution, each a Tier 2 act.
