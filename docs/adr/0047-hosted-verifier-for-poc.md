# 0047. The protocol's hosted verifier gives the verdict for the PoC; the Access Issuer runs its own before execution

- **Status:** Accepted (owner, 25 September 2026)
- **Date:** 25 September 2026

## Context

A verdict needs signature, Merkle, revocation and composition checks the Access Issuer does not
implement itself. The protocol's verifier is a long-running service with in-memory state, which the
site's serverless hosting cannot run.

## Options considered

| Option | Summary |
|---|---|
| Hosted verifier now, own verifier before execution | Forward each presentation to the protocol's hosted verifier; run an instance of its own, with pinned issuer keys, in Wave 6. |
| Own verifier now | The verdict is the Access Issuer's own from the start; needs hosting beside the site. |

## Decision

For the PoC the site forwards each presentation to the protocol's hosted verifier and records
its verdict with the presentation. The Access Issuer is registered there as a verifier, and that
verifier must pin the issuer's key in its trust configuration (ADR 0042). Before execution the
Access Issuer runs its own verifier instance.

## Why

It is the quickest route to a working flow, and the dependency is stated rather than hidden.

## Consequences

- Until Wave 6 the Access Issuer relies on the protocol operator's verdict; the evidence pack says so.
- The site checks what it can itself: the request it signed, the challenge, the credential headers, the issuer and holder identifiers, and that the wallet and officer credentials name the same holder.
