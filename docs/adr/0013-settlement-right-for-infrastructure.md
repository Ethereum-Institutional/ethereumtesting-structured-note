# 0013. A settlement right for infrastructure spenders

- **Status:** Accepted
- **Date:** 24 September 2026

## Context

The debt standard's `approve` refuses an allowance to a spender that cannot send. The settlement
contract takes allowances, so in Wave 3 it was onboarded with investor flags, including Regulation S
and the right to hold.

## Options considered

| Option | Summary |
|---|---|
| Onboard with its own rights | A `SETTLEMENT` right in the registry; the gates accept a spender holding it, separately from the holder masks. |
| Onboard as a holder | As first built: investor flags plus the contract-account flag. |
| Remove the spender check | A seventh adaptation: `approve` stops checking the spender. |

## Decision

Add a `SETTLEMENT` right. A gate's `canSend` is true for an account carrying the gate's settlement mask as well as its send mask; the settlement contract carries only `SETTLEMENT`, `SANCTIONS_CLEAR` and `CONTRACT_ACCOUNT`.

## Why

It keeps the standard's control over who may be approved, without attaching an investor attribute
to a machine. Without `HOLD` or `RECEIVE` the contract cannot be sent units by mistake. Removing the
check would let any address be approved as an operator.

## Consequences

- The gates change before the Wave 4 freeze, so this costs a redeploy, not an upgrade.
- The Paying Agent is a genuine holder of the cash leg in transit and keeps holder flags.
