# 0058. A client can cancel its admission at any step until the grants are being written

- **Status:** Accepted (owner, 27 September 2026)
- **Date:** 27 September 2026

## Context

A client has one open admission at a time (ADR 0054). A client who started presenting from a
holder wallet, then decided to go through its bank instead, had no way out. The same was true of
a self-custody request the client no longer wanted.

## Options considered

| Option | Summary |
|---|---|
| The client cancels until the grants are being written | Available on every route and at every waiting step, including while waiting for the bank's approval. The admission is marked cancelled and the route choices return. |
| Only before any credential is presented | Simpler to explain, but a client waiting on the bank's approval could not change its mind. |
| Let expiry free the client | The holder-wallet codes lapse in five minutes, but a lapsed code is renewed, not abandoned. The client would still be stuck. |

## Decision

The client can cancel its own admission while it is waiting on the bank's review, the wallet
binding, a signature, a holder-wallet scan or the bank's approval. It cannot cancel once the
grants are being written, or after the admission has finished. A cancelled admission is kept and
audited, and the page offers the routes again.

## Why

Nothing on-chain exists until the grants are written, so walking away before then costs nothing.
Every step only moves an admission on from the status it expects. A scan, review or signature
that arrives after a cancel therefore finds the admission cancelled and changes nothing.

## Consequences

- New status `cancelled`, with `cancelledFrom` recording the step the client left.
- Staff can no longer confirm or decide a cancelled request, and it leaves their queue.
