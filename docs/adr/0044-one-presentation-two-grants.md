# 0044. One verified presentation writes both the pool grant and the Identity Registry grant

- **Status:** Accepted (owner, 25 September 2026)
- **Date:** 25 September 2026

## Context

A conversion needs a pool grant and an Identity Registry grant, because the deposit checks the
registry (ADR 0031). ADR 0028 kept registry onboarding with registrars, separately from the
credential protocol.

## Options considered

| Option | Summary |
|---|---|
| One presentation, two grants | The Access Issuer writes both from the same verified presentation; the registry grant cites the primary credential and the verification record. |
| Separate onboarding | The registrar onboards to the registry by its own process; the pool grant follows a presentation. |

## Decision

The Access Issuer, as registrar, writes the registry grant from the same presentation as the pool
grant: its credential reference is the primary credential's identifier and its commitment the hash
of the verifier's record. Flags are the deposit holder's (hold, receive, transfer, sanctions clear),
plus professional for a professional or institutional class and contract account for a contract
wallet. Jurisdiction is the credential's, in ISO numeric. The registry needs no change.
`script/Attest.s.sol` does both. Registrar onboarding without a credential remains possible.

## Why

One verification, one evidence record, two consistent grants: the registry entry points at the
credential it rests on, and an auditor can follow either grant to the same presentation.

## Consequences

- Revoking the credential voids the pool grant at once, but the registry grant runs to its own
  expiry (180 days at most) unless the registrar revokes it or the controller withdraws it. The
  registry does not read the protocol, by design (ADR 0004 is the immediate route).
- The note's Regulation S flag is not set from a credential; a note holder is still onboarded for
  it by the registrar.
- Extends ADR 0028, which kept registry onboarding apart.
