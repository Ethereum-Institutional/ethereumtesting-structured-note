# 0045. Participants present credentials by scanning a QR code with the holder wallet

- **Status:** Accepted (owner, 25 September 2026)
- **Date:** 25 September 2026

## Context

Until now the Access Issuer's input was a verifier result exported by hand from the issuer's
console. The credential protocol already supports a verifier-initiated flow: the verifier signs a
request with its own ML-DSA-65 key, lodges it with the protocol's verifier, and shows its short
address as a QR code; the holder wallet fetches and checks the request and posts a presentation
to the callback the request names.

## Options considered

| Option | Summary |
|---|---|
| QR presentation from the holder wallet | Consent sits with the holder; each presentation is bound to a fresh challenge and to the Access Issuer as verifier, so it cannot be replayed to anyone else. |
| Export from the issuer console | Manual; the holder takes no part; kept as a fallback for testing only. |

## Decision

The gated site signs a request as the Access Issuer, lodges it with the protocol's verifier,
and shows its address as a QR code. The request's callback is the site's own endpoint, so the
site receives each presentation whole and keeps it as evidence; it forwards the presentation to
the protocol's verifier for the verdict (ADR 0047). `script/Attest.s.sol` remains for tests.

## Why

The owner's direction. It is the most direct and the most secure route: nothing is typed or
exported, and the signed request binds the callback, so a presentation cannot be redirected.

## Consequences

- The Access Issuer has a verifier identity (a DID and an ML-DSA-65 key) registered with the protocol, separate from its chain key.
- The site keeps each presentation and verdict; the evidence hash in both grants is their hash.
- A presentation carries one credential, so an admission may need more than one scan (ADR 0046).
