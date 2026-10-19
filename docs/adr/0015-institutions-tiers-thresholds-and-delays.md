# 0015. Institutions, tiers, thresholds and delays

- **Status:** Accepted
- **Date:** 16 October 2026

## Context

An intervention (amending a note, reversing a payment, replacing a role) should need more than one
firm and more than one person in each, and should give everyone time to see it coming. Each
institution already runs signers on established wallet software. Losing one institution's wallet
must neither halt governance nor let the others seize its seat.

## Decision

**One multi-signature wallet per institution.** Each institution operates its own Safe 1.4.1, with
its own signers and threshold. The controller treats each wallet as one institution, and reads its
threshold at approval and again at execution; a wallet that does not answer counts for no
signatures.

| Wallet | Signers | Role |
|---|---|---|
| The Agent's governance wallet | 2 of 3 | An institution, and the only Tier 1 actor |
| The Issuer's wallet | 2 of 3 | An institution, and the note factory's owner |
| The co-signing institution's wallet | 2 of 3 | An institution: a second registrar or an independent trustee, named by capacity |
| The Agent's servicing wallet | 2 of 3 | Servicing only; never an institution |

**Tier 2: two of three institutions, at least four signatures.** A proposal is queued once
approvals come from at least two institutions whose wallets' thresholds sum to at least four. Only
current institutions' approvals count, so a replaced wallet's approval lapses. The proposer may
cancel.

**Delays and a window, fixed at construction:**

| Setting | Target | This deployment |
|---|---|---|
| Tier 2 delay, before execution | 72 hours | 1 hour |
| Recovery delay, replacing an institution | 14 days | 4 hours |
| Execution window, after the delay | 7 days | 1 day |

- The deployment compresses them to fit its calendar; the manifest records both the values used and
  the targets.
- The controller refuses a zero delay or window, a recovery delay not longer than Tier 2's, fewer
  than two institutions required, or fewer signatures than institutions.
- A queued proposal not executed within its window has expired: it cannot be approved, executed or
  cancelled. Acting again means proposing afresh.
- Anyone may execute a proposal that is ready.

**Recovering a lost institution wallet.** `ReplaceInstitution` needs every other institution's
approval and the longer recovery delay, and the wallet being replaced can cancel it while it still
works. A guardian or a single key would be the latent superuser this design avoids.

**If governance is lost.** Should enough institutions lose their wallets, governance freezes by
design and nothing reopens it: there is no break-glass key. Servicing is held apart from
governance, so determinations, coupons and redemptions continue. If a note must move, it is
re-issued on new contracts from the Register.

| Option | Chosen? | Why |
|---|---|---|
| A wallet per institution, two thresholds checked on the chain | Yes | Signer management stays in audited wallet code each institution already runs; the controller stays small |
| One shared wallet | No | It cannot count institutions |
| A signer registry in the controller | No | Duplicates audited wallet code inside our own audit scope |

## Consequences

- On the chain, no single firm and no single signer can intervene.
- Losing one institution neither blocks Tier 2 nor leaves a lone survivor able to replace another.
- The site holds two owners' keys of each wallet, so that one person can demonstrate every
  institution (record 0024).
