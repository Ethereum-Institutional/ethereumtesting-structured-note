# 0005. Identities and claims

- **Status:** Accepted
- **Date:** 16 October 2026

## Context

Who may hold the note, the deposit and the pool's assets must be decided by the institution
responsible for each, checked by the chain at every transfer, and never disclose who a client is.
A client should be known once, not once per asset or per note, and a lapsed or revoked approval
should stop the client without anyone having to send a transaction.

## Decision

**One identity per client, ONCHAINID.**
- ONCHAINID's identity factory belongs to the bank, which creates every identity. The identity
  logic is fixed for good: its implementation authority's owner renounced at deployment.
- A wallet is registered against its identity in **one identity storage** for the deployment. The
  deposit's registry, every note's registry and the pool's registry all read it, so a client
  registered once is known to each.
- The bank registers and removes wallets, as the agent of the deposit's registry. The note
  registries and the pool's registry only read the storage.
- An identity brought from elsewhere must be an ONCHAINID identity: an address with code that
  answers `keyHasPurpose`. A wallet cannot be its own identity.

**Claims by role.** Each institution vouches, on the client's identity, for what it is responsible
for:

| Topic | What it says | Issued by | Runs for |
|---|---|---|---|
| `claim.deposit-eligible` | The bank holds the client's account; it may hold the deposit | The bank | 180 days |
| `claim.note-eligible` | The client is eligible for the programme's notes under their selling restrictions, and screened | The onboarding agent | 180 days |
| `claim.pool-access` | The client is a professional or institutional investor admitted to the conversion pool | The bank | 90 days |
| `claim.term-sheet` | A note's term sheet: its hash and address | The note, on its own identity | For good |
| `claim.series` | A note's series number and ISIN | The note, on its own identity | For good |

**One claim for every note.** Every note's registry requires the same note claim, from the
onboarding agent's claim issuer, so a client approved once may hold any note of the programme. A
series may require up to four further claims of its own, each from an issuer it names, at issuance
(record 0009). Selling-restriction answers are given once, for every note.

**Claims that lapse: `ExpiringClaimIssuer`.** One per institution, built on ONCHAINID's Identity.
- A claim's data is `abi.encode(issuedAt, validUntil, recordHash)`. The record hash is a salted
  hash of the record the institution keeps off-chain, so nothing in a claim identifies the client.
- A claim is valid while one of the issuer's claim keys signed it, it is not revoked, it was issued
  no later than now, it has not lapsed, and it runs no longer than the issuer's `maxValidity`
  (365 days at deployment).
- A lapsed claim needs no transaction: the registry's next check fails.
- Revocation is immediate, by the issuing institution's management key.
- Not upgradeable. A changed rule is a new issuer, which governance trusts in place of the old.

**How a claim is added, with the client's consent:**
1. the bank creates the identity, with the manager the route calls for (record 0007);
2. the identity's manager adds the institution's key as a claim key: the client's consent;
3. the institution signs its claim and adds it to the identity itself.

Re-screening is a fresh claim. Offboarding revokes the bank's claim and removes the wallet from the
storage, so it is known to no registry.

## Consequences

- Eligibility for each asset is the asset's own registry asking the storage and its trusted
  issuers; no part of the site decides it.
- A revoked or lapsed claim stops transfers, settlement and conversion at once.
- The storage binds at most 300 registries. Redeemed notes are unbound from it by governance, and
  it can be handed on to a successor factory with every identity in it (record 0009).
- The site registers every wallet with one country code (276). The pool's jurisdiction check
  (record 0018) therefore reads that code until a route records the client's own.
