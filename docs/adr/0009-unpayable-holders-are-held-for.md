# 0009. A holder the deposit cannot credit is held for

- **Status:** Accepted (Wave 3, L1)
- **Date:** 24 September 2026

## Context

ADR 0003 lets a lapsed holder's notes be burned, but the deposit's gate refuses to credit a
lapsed or withdrawn holder, and the same can happen with a coupon.

## Options considered

| Option | Summary |
|---|---|
| Held, claimable later | The amount stays in the Paying Agent against holder and event; claimed once the deposit accepts the holder. |
| Block the distribution | The event cannot complete until every holder can be credited. |
| Pay past the gate | Credit the holder through a path that bypasses the deposit's gate. |

## Decision

Hold the amount in the Paying Agent, emit it as held, and let anyone claim it for the holder once the deposit accepts them.

## Why

The entitlement is neither lost nor hidden, and one holder cannot hold up payment to everyone
else. Paying past the gate would put the cash leg in the hands of an ineligible account,
contradicting the whitelist of record.

## Consequences

- The event still closes; the Register shows the amount as due but unpaid.
- Held balances remain in the Paying Agent until claimed.
