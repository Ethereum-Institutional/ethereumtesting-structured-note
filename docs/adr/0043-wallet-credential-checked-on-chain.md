# 0043. The wallet-control credential is a third credential, checked on-chain

- **Status:** Accepted (owner, 25 September 2026)
- **Date:** 25 September 2026

## Context

The credential protocol now issues a wallet-control credential binding a wallet to the holder of
a corporate identity or a passport (ADR 0036 follow-up). The protocol can revoke it like any other
credential. Until now the gate recorded wallet control only as a check bit the attester reported.

## Options considered

| Option | Summary |
|---|---|
| A third credential, checked on-chain | The attestation and the grant carry the wallet credential's identifier; at grant the gate refuses it if revoked; anyone may void a grant once it is revoked. |
| A check bit only | The attester checks the credential off-chain; revoking the binding leaves the grant live until it expires. |

## Decision

Every grant names a wallet credential (`walletCredential`, required). The gate refuses a grant
whose wallet credential is revoked, and `void` removes a grant whose wallet credential the protocol
has since revoked, as it does for the other two. The wallet-control check bit stays: it records
that the attester verified the binding to this holder.

## Why

Unbinding a wallet should stop it at once, by the same public route as any other revocation. A
check bit alone leaves up to the maximum validity (90 days) in which a wallet the holder has
disowned can still convert.

## Consequences

- One more storage slot per grant and one more revocation lookup at grant; the swap path is
  unchanged at two reads.
- The grant's calldata and the tape carry the wallet credential's identifier.
- The attester checks that the wallet credential is bound to the same holder as the primary
  credential (`script/Attest.s.sol`); the gate cannot, since holder identifiers are not on-chain.
