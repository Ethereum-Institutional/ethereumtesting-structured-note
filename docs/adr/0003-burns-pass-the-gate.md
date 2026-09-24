# 0003. Burns pass the instrument gate

- **Status:** Accepted (Wave 2, W1)
- **Date:** 24 September 2026

## Context

Grants expire (bounded eligibility). At maturity or an early redemption some holders will have
lapsed grants. Spike 2 recorded as G3 that the gate must decide whether a burn tests the holder.

## Options considered

| Option | Summary |
|---|---|
| The gate allows all burns | A burn tests nothing at the gate; only the token's burner role can burn. |
| A burn needs a live grant | Lapsed holders are redeemed only by forced transfer to zero, a logged intervention. |
| Burns only after maturity | The gate allows burns without eligibility only after a fixed timestamp. |

## Decision

The gate tests nothing on a burn. Burn authority is the token's burner role.

## Why

Redemption stays routine for every holder, and the ERC-7943 Final text allows permissioned burns
to bypass the send check. Requiring a live grant would make every lapsed-holder maturity an
intervention and multiply use of forced transfer, the most powerful function in the system. A
maturity-timestamp rule fails for early redemption and ties an immutable gate to one instrument's
dates.

## Consequences

- The cash side is a separate question: the deposit still refuses to credit a lapsed holder,
  answered by ADR 0009.
- A burn from a sanctioned holder is not stopped by the gate; only the Agent can burn, and a burn
  ends the position rather than moving it.
