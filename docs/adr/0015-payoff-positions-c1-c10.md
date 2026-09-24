# 0015. Positions on payoff confirmations C1 to C10

- **Status:** Proposed: for confirmation by the Issuer and the Calculation Agent
- **Date:** 24 September 2026

## Context

Spike 3 section 10 lists ten items only the Issuer and the Calculation Agent can confirm. The
contracts implement a default for each. These are the positions to put to them.

## Options considered

| Option | Summary |
|---|---|
| C1 barrier observation | Final date only (chosen) / every scheduled date / continuous (unsupported). |
| C2 boundaries | Barrier strict, coupon and MER inclusive (chosen) / all inclusive / mirror the term sheet. |
| C3 scenario B | Only if the final ratio is below 100% (chosen) / always once breached. |
| C4 memory | No memory (chosen) / memory. |
| C5 Twin Win | Not applicable / **applicable (chosen)**, illustratively 100% up, 100% down, capped at 150% until the term sheet gives figures. |
| C6 par plus accrued | CA plus that date's coupon (chosen) / CA plus pro-rata interest / CA only. |
| C7 rounding | Nearest cent, half up, once per CA (chosen) / round down / round per holder. |
| C8 Record Time | Inclusive at the exact timestamp (chosen) / exclusive. |
| C9 transfer stop | Yes (chosen) / no, settle by claim. |
| C10 signing | Levels and outcome (chosen) / Levels only. |

## Decision

Put each chosen position to the Issuer and the Calculation Agent. Every position is the spike 3
default except C5, where Twin Win is to be applicable.

## Why

The defaults resolve each exact boundary in the investor's favour where common wording allows,
keep reconciliation free of residue (C7), protect a buyer after the Record Time (C9), and keep
every payment the product of two independent computations (C10). C5 follows the client draft's
"with Twin Win if applicable", taken as applicable; its figures are illustrative until supplied.
C7 and C8 should first be checked against the Programme's own conditions.

## Consequences

- Every item is a parameter or a single clause; a changed answer changes terms or one line, and
  the vector grid is regenerated.
- The local issuance uses the illustrative Twin Win figures.
