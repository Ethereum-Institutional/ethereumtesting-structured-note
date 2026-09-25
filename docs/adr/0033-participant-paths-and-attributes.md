# 0033. Two participant paths, entity and natural person, on the protocol's own schema fields

- **Status:** Accepted (Wave 5)
- **Date:** 25 September 2026

## Context

The protocol's schemas define the attributes available. There is no "KYC level" and no entity
type field. Entities have a corporate identity schema (legal form, jurisdiction, status); natural
persons a passport schema (expiry, age, sanctions screen); both can hold a screening schema
(politically exposed flag, screening time, residence jurisdiction, investor class:
sophisticated, professional, institutional or retail).

## Options considered

| Option | Summary |
|---|---|
| Both paths | An entity (KYB) path and a natural person (KYC) path, each its own policy. |
| Entity only | Institutions only. |
| Person only | What the protocol can issue on the target network today. |

## Decision

Two paths. Entity: corporate identity with status active and not expired, plus the entity's
screening credential. Natural person: passport not expired, over 18 and sanctions screen clean,
plus the screening credential with not politically exposed. Both: wallet control proven,
jurisdiction in the allowlist, screened within 30 days, investor class professional or
institutional. The default allowlist is the 30 EEA states, Switzerland and the United Kingdom;
the United States is excluded, consistent with Regulation S.

## Why

Institutions are the expected participants and need the entity path; the person path is what
the protocol can issue on the target network today and so is what live testing will use. Each
parameter is a constructor argument (ADR 0032), so a different policy is a different gate.

## Consequences

- The jurisdiction is the screening credential's residence jurisdiction for a person and the corporate identity's for an entity.
- Corporate officer presentation (HANDOFF section 4) is not required by the entity path yet.
- Only passport-backed credentials can be issued on the target network today (ADR 0041).
