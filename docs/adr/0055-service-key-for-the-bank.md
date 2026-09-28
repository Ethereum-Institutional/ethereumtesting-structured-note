# 0055. The site reaches the bank's issuer with a scoped service key, not a staff session

- **Status:** Accepted (owner, 26 September 2026)
- **Date:** 26 September 2026

## Context

The custodied and self-custody routes (ADR 0054) call the bank's issuer operator API. The first
integration borrowed a staff member's console session: it carried that person's whole role,
ended when they signed out or after 30 days, and attributed the site's actions to them.

## Options considered

| Option | Summary |
|---|---|
| Scoped service key now, OAuth 2.0 client credentials before anything real | A key issued to the site as a named service, with only the scopes it uses, an expiry, revocation and rotation, audited under its own name. Production: client credentials with private_key_jwt or mutual TLS, so no bearer secret is shared. |
| A staff session | As first built. |
| OAuth 2.0 client credentials now | The target, but more than the PoC needs today. |

## Decision

The site authenticates with a service key (`BANK_ISSUER_API_KEY`, `sk_...`) in the Authorization
header, over HTTPS only, holding `credentials:read`, `wallet-attestation:eth` and, for the
holder-wallet route, `verify-requests:create`. A 401 or 403 is reported in plain words and never
retried. The staff session is removed from the site's configuration. Before anything real, the
integration moves to OAuth 2.0 client credentials with private_key_jwt or mutual TLS.

## Why

Least privilege, a lifetime and an owner of its own, and an audit trail that names the system that
acted. It is also the credential the bank's own integration guidance prescribes.

## Consequences

- The key is a secret held in the site's configuration (a Vercel sensitive variable) and in the
  ignored key file; it is stored through a hidden prompt and never passes through a transcript.
- The first key issued answered to scopes it was not asked for; it is to be re-issued with the
  three above.
- Rotation replaces the key without touching any staff account.
