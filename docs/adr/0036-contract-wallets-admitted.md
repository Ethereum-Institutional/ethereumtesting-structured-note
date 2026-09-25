# 0036. Contract wallets are admitted by their own signature, so custody accounts can be granted

- **Status:** Accepted (Wave 5)
- **Date:** 25 September 2026

## Context

Wallet control is proved by a signed wallet-control message. The protocol's verifier checks
contract signatures (ERC-1271) in code, but its documentation says they are not yet supported.
Custody accounts are contracts and already implement ERC-1271.

## Options considered

| Option | Summary |
|---|---|
| Accept contract signatures | A custody account is granted on the Custodian's entity credential and the account's own ERC-1271 signature. |
| Ordinary wallets only | Custody accounts cannot use the pool in Wave 5. |

## Decision

Accept both. The attester checks the wallet-control signature off-chain; for a contract wallet
it calls `isValidSignature`. The grant records nothing different.

## Why

Segregated custody is part of the design the venue tests already exercise, and the account
contract already signs.

## Consequences

- We are ahead of the protocol's documented support; this must be confirmed with the vendor before live testing.
- **Follow-up, 25 September 2026:** the owner is building a wallet-control credential in the
  protocol, linked to a corporate identity or a natural person. When it exists, the attester can
  check it instead of a bare signature, and whether the gate should also check its revocation
  on-chain, as a third credential, is a decision for then.
