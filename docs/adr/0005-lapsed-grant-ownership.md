# 0005. A lapsed grant stays with its registrar

- **Status:** Accepted (Wave 2, W3)
- **Date:** 24 September 2026

## Context

When a grant lapses, the registry could either keep it attributed to the registrar that wrote it
or free the address for any registrar.

## Options considered

| Option | Summary |
|---|---|
| Stays with its registrar until revoked | Hand-over is a revoke followed by a new grant, both visible. |
| Expiry frees the address | Any registrar may onboard it once lapsed. |

## Decision

A lapsed grant stays with its registrar until that registrar revokes it.

## Why

A late renewal must not let another institution take over a participant silently. Keeping
ownership means whoever last vouched for the address stays on record, and a deliberate hand-over
leaves two visible acts.

## Consequences

- Migrating a participant between registrars needs the first registrar's revocation, or a
  supervisory withdrawal (ADR 0004).
