# 0032. The policy is fixed at construction, one gate per policy, with one configured issuer

- **Status:** Accepted (Wave 5)
- **Date:** 25 September 2026

## Context

The configured issuer and attribute parameters could be settable on a live gate, by governance or
by an owner, or fixed. The protocol has one active issuer on the target network.

## Options considered

| Option | Summary |
|---|---|
| Fixed, one gate per policy | Constructor parameters with no setter; a change is a new gate and a Tier 2 repoint. |
| Governance may change it | A Tier 2 act changes parameters in place. |
| The owner may change it | An owner key changes parameters. |
| A list of issuers | Several issuer DIDs per gate. |

## Decision

Every parameter is set in the constructor and never changes: the issuer DID, the two
participant paths' schemas and required checks, the jurisdiction allowlist, the accepted investor
classes, the screening age, the maximum validity and the revocation-root freshness window. One
issuer per gate.

## Why

It mirrors the instrument gates, which are immutable with masks as constructor parameters. A
policy that cannot change under a grant means every live grant was written under the policy the
gate states. An in-place setter would need a new typed controller act for every parameter; a
second issuer is a second gate if ever needed.

## Consequences

- Existing grants do not carry over to a new gate; participants are re-attested.
- The policy is readable on-chain, parameter by parameter.
