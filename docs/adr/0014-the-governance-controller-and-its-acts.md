# 0014. The governance controller and its acts

- **Status:** Accepted
- **Date:** 16 October 2026

## Context

Every privileged power over every note, the deposit's roles and the conversion venue must sit in
one place a reviewer can read, be exercised only by the institutions together or, for urgent
supervision, by the Agent with a written reason, and never through a general call path that could
do anything. A desk running many notes must be able to rotate a role, or act on a client, once for
the whole book.

## Decision

**One `GovernanceController` for the programme.**
- **It governs every note from its first block.** The note factory hands each note to it in the
  issuing transaction, and it accepts there (`adopt`): it owns the note's token, registries and
  compliance, manages its identity, and is the note's only agent beyond the note's own Paying
  Agent and settlement contract. It is bound to one factory, once.
- **Every act names the note it concerns,** checked against the notes it governs.
- **It administers the deposit's and the gateway's roles,** and owns the pool's identity registry
  and, where the pool is deployed, the venue (record 0018).

**Typed acts, no calldata.** Each permitted act is its own entry point with typed arguments. A
proposal stores those arguments, never calldata, and the controller builds every downstream call
itself. This source is the complete permitted set. Every act carries a written reason, emitted in
full. Two libraries, called by delegatecall, keep it under the size limit: `VenueActs` and
`CorrectionActs`.

**The programme's register of roles** (`IProgrammeRoles`), held once here and read by every note's
lifecycle contracts at each act:

| Role | Who holds it | What it does |
|---|---|---|
| Servicing wallet | The Agent's 2-of-3 Safe | Opens and pays distributions; pauses a note; switches pool swapping |
| Calculation Agent | The Calculation Agent's key | Signs determinations |
| Funder | The Agent's deposit account | Every distribution is drawn from it |

Each is rotated by one Tier 2 act, for every note at once. The servicing wallet is never an
institution, and a role is never rotated to an institution's governance wallet.

**The acts:**

| Who | Acts |
|---|---|
| Tier 1: the Agent's governance wallet alone, at once | Correct a note's register by forced transfer; freeze or unfreeze an account on one or many notes; recover a lost wallet across every note it holds; designate an account under the programme's sanctions, or lift it; cancel units from the Issuer's inventory; withdraw or restore an account's pool access |
| Servicing: the servicing wallet, at once | Pause or unpause a note; switch swapping in the pool off or on |
| Tier 2: the institutions, after a delay | Amend a note's notional in the inventory; reverse a coupon; restate it; correct a determination; trust or stop trusting a claim issuer for a note; replace the servicing wallet, the Calculation Agent or the funder; replace an institution's wallet; grant or revoke a role on the deposit or gateway; retire a redeemed note from the identity storage; hand T-REX's factory to a successor; and the venue's acts (record 0018) |

Wallet recovery is refused on a note while its transfers are stopped at a Record Time, and the
note's record dates are synced in the same transaction.

**Nothing is upgradeable,** and no act changes the thresholds, the delays or the set of acts.

**On the site.** Each institution acts as itself: every act is its own Safe's transaction, signed
by two of its owners' keys the site holds and sent by an ordinary key, first simulated from the
wallet so a refusal is the controller's own reason in plain words. The Tier 1 page acts on the note
chosen, and offers "attempt a forced transfer as the Agent", which simulates the servicing wallet
trying and shows who does hold the right. Tier 2 offers only acts that cannot break the deployment
the site runs (amend notional, trust a claim issuer, correct a determination, retire a note,
approve a liquidity provider); replacing a role or an institution, changing the deposit's roles
and releasing the factory are listed but proposed from the institutions' own wallets.

## Consequences

- A reviewer reads one contract to know every power over every note.
- One act freezes a client, or recovers its wallet, across the whole book.
- Routine servicing is never signed by the wallets that hold intervention powers.
