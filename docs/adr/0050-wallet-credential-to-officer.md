# 0050. The wallet-control credential is issued to the officer who presents

- **Status:** Accepted (owner, 25 September 2026)
- **Date:** 25 September 2026

## Context

A presentation is signed by its holder, and a corporation does not run the holder wallet
(ADR 0046). A wallet-control credential whose subject is the corporation cannot be presented
from an officer's wallet.

## Options considered

| Option | Summary |
|---|---|
| Issued to the officer's DID | The officer's wallet presents it; the chain of trust is wallet, officer, corporation, corporate identity. |
| Issued to the corporation's DID | Cannot be presented from the officer's wallet. |

## Decision

The wallet-control credential's subject is the presenting officer. The Access Issuer requires
that its subject equals the officer credential's subject, and that the officer credential's
corporation equals the corporate identity's subject.

## Why

It is the only form the holder wallet can present, and it records which officer bound the
wallet, not only which corporation.

## Consequences

- The wallet credential issued earlier to the corporation's DID must be re-issued to the officer.
- The pool wallet is the corporation's; the officer attests control of it on the corporation's behalf, under the officer credential's authority.
