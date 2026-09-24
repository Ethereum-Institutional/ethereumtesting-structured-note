# 0011. Distributions are pushed, verified and reconciled on-chain

- **Status:** Accepted (Wave 3, L3)
- **Date:** 24 September 2026

## Context

The note's holder list is current, not historical, so it misses anyone who held at the Record Time
and sold before payment.

## Options considered

| Option | Summary |
|---|---|
| Push, verified, reconciled | The Agent supplies holders from the Register; units come from the record-date balance; the event closes only when units paid equal units entitled. |
| Holders claim | Each holder collects their own payment. |
| Contract walks the holder list | The Paying Agent iterates the current holder list. |

## Decision

Push in batches from the Register, verify each holder against the record-date balance, and close only on full reconciliation.

## Why

The Register is golden source (D7); the chain verifies it. A Register that omits a holder cannot
close the event, and one that invents a holder cannot pay it. Claims leave amounts outstanding at
closure; walking the current list pays the wrong people.

## Consequences

- The inventory is excluded and, at redemption, burned on closing (E2).
- Every event debits the Agent once, for exactly the amount due.
