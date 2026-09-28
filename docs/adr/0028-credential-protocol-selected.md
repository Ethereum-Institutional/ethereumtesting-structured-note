# 0028. The credential protocol is selected, for the conversion pool first

- **Status:** Accepted (Wave 5)
- **Date:** 25 September 2026

## Context

D12 deferred the choice of credential platform and specified the layer by capability. The owner
has now selected a verifiable-credential protocol, named in the private working documents, whose
issuer and revocation registries are deployed on the target test network. HANDOFF section 4 asked
that the status of the commercial compliance engines be checked before deciding; the owner has
decided without that check, and this record says so.

What the protocol provides, read from its contracts and its issuing and verifying services:
issuer activity and credential revocation on-chain; signature and Merkle verification off-chain
only (its post-quantum signatures are too costly on-chain); no on-chain schema registry, no
attributes and no address binding on-chain. Its own contracts warn against calling its verifier on
a hot path and describe the pattern this repository already uses: verify once off-chain, write a
bounded grant, gate on one read. Its integration guide still shows a per-swap check and is out of
date against its contracts.

## Options considered

| Option | Summary |
|---|---|
| Select it, for the pool first | The pool's eligibility perimeter uses the protocol now; the instruments' registry keeps its registrar onboarding until a later decision. |
| Select it for everything | The Identity Registry's grants are also written from protocol credentials in Wave 5. |
| Keep deferring | Build the pool gate against a capability interface with a stand-in only. |

## Decision

The protocol is selected. In Wave 5 it gates the conversion pool (ADRs 0030 to 0041). The
Identity Registry continues to be written by registrars as before; moving its onboarding onto the
protocol is a separate decision.

## Why

The owner's direction, and the protocol's on-chain surface fits the grant pattern already
adopted, so selecting it costs no change of approach. Starting with the pool keeps the change to
the frozen instruments small (ADR 0026) and tests the protocol where the owner asked for it.

## Consequences

- D12 is closed for the pool. HANDOFF section 4's check of the commercial engines was not made.
- Test credentials cannot be obtained from a faucet: a grant needs an NFC passport read in the protocol's wallet, or the vendor's own stack. Live testing needs the vendor to issue test credentials or register a test issuer (ADR 0041).
- The deployed protocol proxies were upgraded after the vendor's own deployment record was written; the live implementations are the ones used (ADR 0040).
- **25 September 2026:** the configured issuer is now a bank issuer on the protocol's new pair of
  registries on the test network, with its first revocation root published; both are named in
  the network file (ADR 0029). The protocol's `REGISTRAR_ROLE` is global over every issuer, so a
  registrar outside the protocol operator can re-key or deactivate any issuer, this pool's
  included; delegating it needs registrar scoping in the protocol first.
- **Extended by ADR 0044:** the Identity Registry grant is now written from the same verified
  presentation as the pool grant.
