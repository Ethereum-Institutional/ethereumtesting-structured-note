# 0019. A lost institution wallet is replaced by the others, slowly, with veto

- **Status:** Accepted (design; built in Wave 4)
- **Date:** 24 September 2026

## Context

Under ADR 0016 each institution's wallet rotates its own signers, so a lost signer is routine. The
hard case is a wallet that can no longer reach its own threshold. For the Agent it stops Tier 1
and the operational roles the wallet holds; for another institution it can leave Tier 2 short of
its institution count. The deploying key renounces its rights, so nothing outside governance can
repair it (HANDOFF section 4).

## Options considered

| Option | Summary |
|---|---|
| Others replace it, slowly, with veto | One recovery act in the controller: replace an institution's wallet, approved by every other institution, after an extended timelock with on-chain notice; the old wallet can cancel in the window. |
| No recovery, re-issue from the Register | A lost wallet stays lost; re-issue on new contracts if servicing cannot continue. |
| Independent recovery guardian | A named third party may replace a wallet after a timelock. |

## Decision

The controller carries a single recovery act, `replaceInstitution`, that swaps one institution's
wallet for another. It needs approval from every other institution, then an extended timelock
(proposed 14 days, longer than the ordinary Tier 2 delay) with an on-chain notice stating the
reason, during which the wallet being replaced can cancel it if it still works.

## Why

It preserves continuity without a new party or a single key. Requiring every other institution
makes recovery at least as hard as any Tier 2 act; the extended timelock and the veto make it
unusable as a way to seize another institution's seat, because a working wallet can always stop
it. Re-issuing a live note for a lost wallet is disproportionate, and a guardian is the latent
single point that section 7's two-institution principle exists to avoid.

## Consequences

- One more privileged path in audit scope, and it belongs to the fixed selector set.
- With only two institutions, the survivor alone can replace the other, protected only by the
  notice and the veto window. A third institution in the governance set removes that weakness.
- The timelock length is a ceremony parameter, fixed in Wave 4.
