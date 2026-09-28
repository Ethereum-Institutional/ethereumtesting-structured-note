# 0053. Entities admitted on the bank's KYB are institutional by policy

- **Status:** Accepted (owner, 26 September 2026)
- **Date:** 26 September 2026

## Context

The pool's policy accepts only professional and institutional investors (ADR 0033), and the
entity path read the class from the corporate identity. The protocol's corporate identity schema
has no investor class claim. The bank holds the classification on file as part of its KYB.

## Options considered

| Option | Summary |
|---|---|
| Institutional by policy | An entity admitted on the bank's corporate identity is treated as institutional; a class the credential does carry is still read and checked. |
| Add the claim to the schema | The protocol's schema gains an investor class claim. |

## Decision

On the entity path, a corporate identity with no investor class is admitted as institutional. If
the credential does carry a class, that class is used and checked against the policy as before.

## Why

The owner's position: the bank classifies its clients already, and the PoC should not wait on a
schema change to restate it.

## Consequences

- The classification rests on the bank's KYB, not on a claim in the credential; the evidence pack
  says so.
- A retail or sophisticated entity would be misclassified if the bank issued it a corporate
  identity; the bank's KYB is what prevents that.
