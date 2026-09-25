# 0023. Timelocks are parameters: 72 hours and 14 days, compressed for the PoC

- **Status:** Accepted (Wave 4)
- **Date:** 25 September 2026

## Context

The Tier 2 delay is the notice that an intervention is pending; the recovery delay (ADR 0019) is
longer on purpose. The recorded PoC execution runs a compressed calendar.

## Options considered

| Option | Summary |
|---|---|
| Parameters, 72 h and 14 d, compressed for the PoC | Fixed at construction; the PoC uses proportionate values stated in the evidence pack. |
| Fixed 72 h and 14 d everywhere | What is tested is what would run. |
| Short fixed delays | One hour and one day everywhere. |

## Decision

Both delays are constructor parameters. The recorded target is 72 hours for Tier 2 and 14 days
for recovery; the PoC execution uses compressed values proportionate to its calendar and states them
in the evidence pack. The controller refuses a zero delay and a recovery delay not longer than the
Tier 2 delay.

## Why

Stretching the programme by three days per intervention scenario tests nothing a compressed delay
does not, while short fixed delays would understate the control and be read as the design.
Asserting the ordering keeps the intent structural.

## Consequences

- The evidence pack must state the delays used, beside the target values.
