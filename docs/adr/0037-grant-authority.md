# 0037. Grants are written by the Access Issuer, withdrawn under supervision, and voided by anyone on revocation

- **Status:** Accepted (Wave 5)
- **Date:** 25 September 2026

## Context

Someone must write, remove and void grants, and the controller must be able to stop an account
at once, as it does in the Identity Registry (ADR 0004).

## Options considered

| Option | Summary |
|---|---|
| Three authorities | `ATTESTER_ROLE` grants and revokes; `SUPERVISOR_ROLE` withdraws with a written reason; anyone voids on protocol revocation or suspends on issuer deactivation. |
| Attester only | One key does everything. |

## Decision

The Access Issuer holds `ATTESTER_ROLE`. `SUPERVISOR_ROLE` and the admin role go to the
controller in the ceremony, and the deployer renounces. Appointing or removing an attester is a
Tier 2 act.

## Why

It matches the registry's split between registrar and supervisor, keeps the reason on the
record for an intervention, and lets revocation take effect without waiting on anyone's key.

## Consequences

- The controller's supervisory withdrawal of pool access is Tier 1, like the registry's (ADR 0039).
