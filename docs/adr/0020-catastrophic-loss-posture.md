# 0020. On catastrophic loss, governance freezes, servicing continues, and the note is re-issued

- **Status:** Accepted (separation built in Wave 4; runbook in Wave 6)
- **Date:** 24 September 2026

## Context

If too many institutions lose their wallets at once for even the recovery act of ADR 0019 to run,
no one can upgrade or amend: the deployer has renounced its rights, which the overview requires
and verifies under test.

## Options considered

| Option | Summary |
|---|---|
| Freeze, keep servicing, re-issue | Governance stays frozen; servicing continues where it does not depend on the lost wallets; the note moves by re-issue from the Register. |
| Keep a sealed break-glass key | A dormant key restores governance after a very long timelock. |
| Time-limited upgradeability | The deployer keeps upgrade rights until a set date. |

## Decision

Governance freezes by design and nothing reopens it. Servicing roles are held apart from the
governance wallets wherever the roles allow, so determinations, coupons and redemptions continue.
If the instrument must move, it is re-issued on new contracts from the Register (D7), under a
written runbook exercised in the dry run.

## Why

No latent power exists anywhere, which is the property a reviewer will test. A break-glass key
contradicts the verified renunciation and is exactly the superuser section 7 warns against;
time-limited upgradeability leaves a single key able to change the instrument through the period
an audit cares about most. Because the Register is golden source, re-issue loses nothing of
record.

## Consequences

- Wave 4 assigns servicing roles (paying, determination submission, minting and burning for
  issuance and redemption) to holders distinct from the Tier 2 governance set, and records which
  functions stop if governance is lost.
- A re-issuance runbook is written in Wave 6 and rehearsed in the dry run (programme phase 6).
