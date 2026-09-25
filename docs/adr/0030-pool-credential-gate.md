# 0030. The pool has its own credential gate: verify off-chain, check issuer and revocation on-chain, gate on one read

- **Status:** Accepted (Wave 5)
- **Date:** 25 September 2026

## Context

The pool must admit only participants holding a credential from a configured issuer whose
attributes meet configured parameters. The protocol verifies credentials off-chain only. Its two
shipped gates each fall short: one stores only an expiry; the other's claim carries no attribute
and no expiry.

## Options considered

| Option | Summary |
|---|---|
| Our own gate | The Access Issuer verifies the presentation off-chain with the protocol's verifier and submits an attestation; at grant the contract checks the issuer is the configured one and active, neither credential is revoked, and the attested attributes meet the policy; it stores an expiry. Anyone can void a grant once the protocol shows a credential revoked. |
| The protocol's expiry-only registry | Issuer and attributes visible only in off-chain configuration; grants do not follow revocation. |
| The protocol's identity-registry gate | No expiry and no attributes: breaks bounded eligibility (section 7). |
| Grants in the Identity Registry | One grant per account, owned by one registrar (ADR 0005), so a note investor onboarded elsewhere could never be admitted. |
| Verify on every swap | The protocol's own contracts warn against it (about 420,000 gas), and its verifier is not deployed on the target network. |

## Decision

`PoolCredentialRegistry`, in the venue unit. An `ATTESTER_ROLE` (the Access Issuer) writes a
grant from an attestation. At grant: the issuer is active in the protocol, neither credential is
revoked, the attested values meet the policy (ADRs 0032 to 0034), and the expiry is bounded
(ADR 0035). `isAllowed(account)` reads the grant's expiry and the issuer's suspension, and never
reverts. `void(account)` is open to anyone and removes a grant whose credential the protocol has
revoked; `suspendIssuer()` is open to anyone once the protocol deactivates the issuer, and
suspension is permanent for that gate.

## Why

It is the pattern the protocol's authors intend for on-chain consumers and the one section 7
states: eligibility established cryptographically, recorded on-chain, bounded in time, revocable
immediately. It is the only option that makes the configured issuer and the parameters checkable
on-chain while keeping the swap path to storage reads.

## Consequences

- The contract trusts the attester's reading of the credential; the signature check is off-chain. This is stated, never upgraded to "verified on-chain".
- A revocation takes effect when someone calls `void`, not when the protocol records it. The Access Issuer's service calls it on every revocation event it sees; anyone else may.
- A suspended issuer is not resumed on the same gate: recovery is a new gate, repointed by Tier 2 (ADRs 0032, 0039).
- One more contract in audit scope.
