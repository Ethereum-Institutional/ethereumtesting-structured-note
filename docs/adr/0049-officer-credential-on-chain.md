# 0049. The officer's credential is a fourth credential, required on the entity path

- **Status:** Accepted (owner, 25 September 2026)
- **Date:** 25 September 2026

## Context

Under ADR 0046 an entity is admitted on an officer's presentation. The officer's authority is
itself a credential, which the corporation can revoke when the officer leaves or is removed.

## Options considered

| Option | Summary |
|---|---|
| A fourth credential, checked on-chain | The attestation and the grant carry the officer credential's identifier; required on the entity path; refused if revoked at grant; voidable by anyone once revoked. |
| Checked off-chain only | The grant survives the officer's departure until it expires. |

## Decision

Every grant carries an `authorityCredential`. On the entity path it is the officer-role
credential and is required; on the natural person path, where the holder acts for itself, it is
empty. The gate refuses a revoked one at grant, and `void` removes a grant whose officer
credential the protocol has since revoked.

## Why

The officer's authority is what made the admission legitimate; when it ends, the grant should end
by the same public route as any other revocation.

## Consequences

- Four credential identifiers per grant: primary, screening, wallet and authority.
- The swap path is unchanged at two storage reads.
