# 0048. An Access Issuer operator approves each admission; the site then signs both grants

- **Status:** Accepted (owner, 25 September 2026)
- **Date:** 25 September 2026

## Context

A verdict can be turned into grants automatically or after a person reviews it.

## Options considered

| Option | Summary |
|---|---|
| Operator approval | The verdict and the presentation are shown to an operator on the gated site; on approval the site signs the pool grant and the registry grant with the Access Issuer's chain key. |
| Automatic on a GRANT verdict | No human review. |

## Decision

Each admission waits for an operator's approval on the site's operator page. On approval the
server writes both grants from the one presentation (ADR 0044), and the approval is logged beside
the evidence hash. The Access Issuer's chain key and its verifier key are Vercel sensitive
variables on the test network; a key management service is required before anything real.

## Why

It keeps a person in the loop at the point where eligibility is written, matches the site's
existing approval model, and leaves an approval record an auditor can follow.

## Consequences

- Two new secrets on the site: the Access Issuer's chain key and its verifier key.
- Writing grants needs a pool deployed on the test network.
