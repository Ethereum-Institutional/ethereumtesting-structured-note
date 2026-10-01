# 0064. Revoking at the bank is separate from offboarding, and the corporate identity is its own confirmed step

- **Status:** Accepted (owner, 30 September 2026)
- **Date:** 30 September 2026

## Context

A client's credentials live at the bank. Revoking one there withdraws it for everyone who relies
on it. Once the bank records the revocation on-chain, anyone can void a pool grant resting on it.
The site's service key may call `POST /v1/credentials/:cid/revoke` (scope `credentials:revoke`).

## Options considered

| Option | Summary |
|---|---|
| A. The wallet credential, and the corporate identity as a separate, confirmed step | The wallet credential affects one wallet. The corporate identity is the client's KYB, and every wallet onboarded on it falls. |
| B. One button revokes all of an admission's credentials | Simpler, but withdrawing a KYB as a side effect of removing a wallet is easy to do by mistake. |

## Decision

A. **Revoke at the bank…** on an admitted account offers two forms, each needing a reason:
- **The wallet credential** is revoked for this wallet only.
- **The corporate identity** form shows how many admitted wallets rest on it and needs a
  confirming tick. The site recounts before revoking and stops if the number has changed.

Each revocation is recorded with the admission and in the audit log. Revoking does not offboard.
The row says so, and staff offboard to remove the grants at once. Otherwise anyone can void the
pool grant once the revocation is on-chain.

## Why

Offboarding is the site's act on its own grants. Revocation is the bank's act on its own
credentials. Keeping them apart keeps each reversible in its own place, and stops a KYB being
withdrawn by accident.

## Consequences

- The service key needs `credentials:revoke`.
- The stand-in bank records revocations on the local chain, so the tests void a grant as an
  unprivileged caller.
