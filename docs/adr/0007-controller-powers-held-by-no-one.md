# 0007. Controller powers are held by no one until the controller exists

- **Status:** Accepted (Wave 2, W5)
- **Date:** 24 September 2026

## Context

Until the Wave 4 ceremony, privileged roles sit with capacity keys on the local node only. The
question was whether forced transfer, upgrade and supervisory withdrawal should be granted in the
interim.

## Options considered

| Option | Summary |
|---|---|
| As now, minus forced transfer | Operational roles to capacities; upgrade, forced transfer and withdrawal to no one. |
| As now, forced transfer included | The Agent holds forced transfer until Wave 4. |
| Bring governance forward | Stand up a minimal multi-signature and controller now. |

## Decision

Upgrade, forced transfer and supervisory withdrawal are held by no one until the controller exists. A test asserts it.

## Why

No step of issuance or servicing needs them, and the most powerful function in the system should
never sit with a single key, even locally, where the pattern could be copied into a later
deployment. Bringing governance forward would have meant settling the multi-signature question
(ADR 0016) out of order.

## Consequences

- Register correction and reversal wait for Wave 4 (ADR 0014).
- The deployer holds each admin role until it renounces them in Wave 4.
