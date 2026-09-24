# 0004. Supervisory withdrawal from the registry

- **Status:** Accepted (Wave 2, W2)
- **Date:** 24 September 2026

## Context

Registrar authority is scoped by construction: a registrar acts only on participants it
onboarded. If a second registrar's participant must be stopped at once, for example on a sanctions
designation, the Agent had no direct path.

## Options considered

| Option | Summary |
|---|---|
| Supervisory withdrawal | `withdraw(account, reason)` on any grant, under its own role held by the Wave 4 controller, immediate, reason emitted in full. |
| Strict scoping only | The Agent freezes the account on each instrument separately. |
| Registry admin revokes | The admin multi-signature revokes directly, with no controller and no reason. |

## Decision

Add supervisory withdrawal under `SUPERVISOR_ROLE`, held by no one until the controller exists.

## Why

One act removes eligibility across the note, the deposit and, from Wave 5, the venue, with a
written reason on the record. Per-instrument freezes leave the venue open, since it reads the
registry. A bare admin revocation bypasses the fixed selector set and carries no reason.

## Consequences

- Registrars keep their scoping; the supervisor acts over the whole whitelist, not as a registrar.
- Withdrawal only restricts, so it carries no timelock.
- One more privileged function in audit scope.
