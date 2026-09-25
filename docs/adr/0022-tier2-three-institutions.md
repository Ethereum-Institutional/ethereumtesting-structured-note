# 0022. Tier 2 is two of three institutions and at least four signatures

- **Status:** Accepted (Wave 4)
- **Date:** 25 September 2026

## Context

Section 7 requires Tier 2 to count both signatures and distinct institutions. The overview asks
for quorum across two institutions, with a second registrar co-signing intervention. ADR 0019 left
a weakness with only two institutions: the survivor alone could replace the other.

## Options considered

| Option | Summary |
|---|---|
| Three institutions, 2 of 3, 4 signatures | Agent, Issuer and a second co-signing institution; approvals from two whose wallets together need four signatures. |
| Two institutions, both, 4 signatures | Agent and Issuer only; both must approve. |
| Three institutions, all three | Every Tier 2 act needs all three. |

## Decision

The Tier 2 set is three institutions: the Agent, the Issuer and a second co-signing institution
(a second registrar or an independent trustee, named later by capacity). A Tier 2 act needs
approvals from at least two institutions whose wallets' own thresholds sum to at least four.

## Why

Two from each of two firms is the control section 7 describes, and a third institution means the
loss of one neither blocks Tier 2 nor leaves a lone survivor able to replace another (ADR 0019).
Requiring all three would let one unavailable institution halt reversals and recovery.

## Consequences

- A third institution must be identified and onboarded before execution.
- Both thresholds are constructor parameters, fixed per deployment.
- The signature count is read from each wallet's own threshold at queue time and again at execution.
