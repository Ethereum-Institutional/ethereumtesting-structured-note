# 0016. Multi-signature is one wallet per institution

- **Status:** Accepted (design; built in Wave 4)
- **Date:** 24 September 2026

## Context

Section 7 requires Tier 2 to count both signatures and distinct institutions; Tier 1 is "Agent
multi-signature". The meaning of multi-signature was never specified (HANDOFF section 4), and it
sets audit scope, ceremony design and hardware wallet support.

## Options considered

| Option | Summary |
|---|---|
| One wallet per institution | Each institution runs its own established, audited open-source multi-signature wallet; the controller counts institution wallets and sums their thresholds. |
| Signer registry in the controller | The controller holds individual signer keys mapped to institutions and verifies their approvals itself. |
| One shared wallet | A single k-of-n wallet with every institution's signers. |

## Decision

Each institution operates its own instance of an established multi-signature wallet. The
controller treats each as one institution: Tier 2 needs approvals from at least N institution
wallets whose combined internal thresholds reach M. Tier 1 is the Agent's own wallet.

## Why

Signer management, rotation and hardware wallet support stay in audited code each institution
already operates; the controller stays small; and both Tier 2 thresholds are enforced on-chain. A
controller-side signer registry duplicates audited work inside our audit scope. One shared wallet
cannot count institutions, which section 7 says a single number cannot express.

## Consequences

- The signature count relies on each wallet's reported threshold, read on-chain.
- The local stack needs the wallet contracts, or a faithful stand-in, deployed.
- Key recovery posture (HANDOFF section 4) is still to be decided and interacts with this.
