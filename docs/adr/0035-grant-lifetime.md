# 0035. A grant runs to the earlier of the credential's expiry and a maximum validity; root freshness is off by default

- **Status:** Accepted (Wave 5)
- **Date:** 25 September 2026

## Context

The protocol publishes revocation roots per issuer. On the target network the issuer's last root
is about 40 days old, so any freshness requirement shorter than that would refuse every grant
today.

## Options considered

| Option | Summary |
|---|---|
| Issuer active and not revoked, freshness optional | At grant: the issuer is active and neither credential is revoked; the root freshness window is a parameter, off by default. |
| Require a recent root | Refuse a grant unless the issuer's current root is within a window. |

## Decision

A grant expires at the earlier of the credential's own expiry and the grant time plus the
maximum validity, 90 days on the test network. The screening must be no older than 30 days at
grant. The freshness window is a constructor parameter, zero (off) by default, and bounded to one
year when set.

## Why

Revocation is a direct lookup in the protocol and is checked regardless; freshness guards a
different failure (an issuer that has stopped publishing) and cannot be met on the target network
today.

## Consequences

- A grant can outlive the freshness of its screening by up to the maximum validity. The sanctions backstop at swap time is the registry's grant, which supervisory withdrawal removes at once.
- Infrastructure grants in the Identity Registry (the adapter, Permit2) also expire and need renewal before the pool's deposit leg stops.
