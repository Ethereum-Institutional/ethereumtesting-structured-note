# 0021. The controller's fixed action set is typed actions, with no calldata

- **Status:** Accepted (Wave 4)
- **Date:** 25 September 2026

## Context

Section 7: no general-purpose call path in the controller; a fixed selector set is the entire
difference between a control framework and a back door.

## Options considered

| Option | Summary |
|---|---|
| Typed actions, no calldata | Each permitted act is its own typed function or action kind; the controller builds the downstream call. |
| Selector allowlist | Forward calldata to an immutable list of (target, selector) pairs. |
| Established governor framework | An open governor and timelock framework with an allowlist check added. |

## Decision

Every permitted act is a typed entry point on the controller with checked arguments. A proposal
stores typed arguments, never raw calldata, and the controller composes each downstream call
itself. The complete permitted set is the controller's source.

## Why

The permitted set is readable where a reviewer reads, arguments are checked by the compiler, and
there is no configuration to get wrong. An allowlist passes arguments through unchecked, so an
allowlisted `grantRole` is close to a general path; a governor framework's core model is arbitrary
calls and counts votes, not two thresholds over institution wallets.

## Consequences

- Adding an action after the freeze means a new controller, which is intended.
- Role changes are typed too: a whole servicing wallet is replaced as one act, never role by role.
