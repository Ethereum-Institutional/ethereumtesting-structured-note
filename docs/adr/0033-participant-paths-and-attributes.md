# 0033. Two participant paths, entity and natural person, on the protocol's own schema fields

- **Status:** Accepted (Wave 5); entity path amended the same day
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

## Amendment, 25 September 2026: an entity's screening rides inside its corporate identity

The owner, who operates the credential protocol, will not issue a corporate identity to an entity
that has not been screened, and wants one credential per entity for now.

| Option | Summary |
|---|---|
| Screening inside the corporate identity | The entity presents its corporate identity alone; the attester reads the screening from it. |
| A separate screening credential | As first decided: corporate identity plus the entity's own screening credential. |

**Decision.** The entity path's screening schema is the corporate identity schema, and the
attestation names the one credential in both places; the gate refuses a different screening
credential on that path (`ScreeningNotInCredential`). The entity path now also requires the
attester to report the sanctions screen clean. The screening time is the credential's issuance
time. The natural person path is unchanged.

**Consequences.**
- The corporate identity schema must carry an **investor class**, since the policy requires one
  and it no longer comes from a screening credential. Its jurisdiction is the entity's registered
  jurisdiction.
- Because the screening time is the issuance time, a corporate identity older than the screening
  window (30 days) cannot be granted until it is re-issued (ADR 0035).
- Revoking the corporate identity voids the entity's grant: there is one credential to revoke.
