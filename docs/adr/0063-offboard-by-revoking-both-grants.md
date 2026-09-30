# 0063. Staff offboard an account by revoking both of its grants, with a written reason

- **Status:** Accepted (owner, 30 September 2026)
- **Date:** 30 September 2026

## Context

An admission writes two grants with the site's Access Issuer key: the pool grant and the Identity
Registry grant. The bank needs a way to take a client out again without waiting for either to
expire and without a governance act. The pool gate's `revoke` is open to its attester, and the
Identity Registry's `revoke` to the registrar that wrote the grant. Both are the Access Issuer.

## Options considered

| Option | Summary |
|---|---|
| A. Offboard revokes both grants | The account can no longer convert, or hold or move the deposit. Any balance stays until the bank redeems it through the deposit gateway. |
| B. Remove the pool grant only | The account keeps the deposit and can move it between eligible holders, but cannot convert. |
| C. Both, chosen each time | Two buttons. |

## Decision

A. On `/operator`, an admitted account has **Offboard…**. Staff give a reason, and the site's key
revokes the pool grant and then the Identity Registry grant, skipping either if it is already
gone. The admission becomes `offboarded`, with both transactions and the reason. The credentials
at the bank are untouched, so the client can be onboarded again. Neither revocation carries a
reason on-chain, which only the supervisor's `withdraw` does. The reason is kept with the
admission and in the audit log.

## Why

It mirrors onboarding, and it needs only the key that did the onboarding. It leaves nothing half
removed.

## Consequences

- An offboarded account's deposit balance is frozen until the bank redeems it.
- A supervisory withdrawal with an on-chain reason remains the controller's Tier 1 act.
