# 0013. Settlement by locked offer

- **Status:** Accepted
- **Date:** 16 October 2026

## Context

Units move by placement from the Issuer's inventory, by transfer between clients, and by buy-back
into the inventory. Each must be delivery versus payment: both legs or neither. Both instructions
should be separate acts on the record, custody accounts must take part through their own call
path, and an open offer must not change who is the holder of record.

## Decision

**`LockedSettlement`, one clone per note.** One party offers; the other accepts before the deadline,
and both legs move in that transaction, or neither does.

- **An offer to sell** freezes the seller's units in its own wallet, by ERC-3643's partial freeze,
  the one power this contract holds on the note. The units stay the seller's, so it remains the
  holder of record. It needs the note's allowance for delivery, and refuses more units than are
  unlocked. The contract can never hold the note: it has no identity.
- **An offer to buy** holds the price in the deposit, in the contract, which the deposit
  allowlists.
- **Named or open.** An offer names its counterparty, or none, when any account the note and the
  deposit both accept may take it.
- **Accepting** unlocks, asks the note whether its leg could move (not paused, neither side
  frozen, units free, the buyer verified, compliance content) and the deposit whether its leg
  could, and moves both, or reverts and changes nothing.
- **Ending.** The proposer may cancel, and a named counterparty may decline. Anyone may release an
  offer past its deadline, or once the note is paused, which a redemption does. Unlocking never
  unfreezes more than is still frozen.

**What settles here:**

| Movement | Offer |
|---|---|
| Placement | The Issuer's inventory offers to sell to a named account |
| Buy-back | The Issuer's inventory offers to buy from a named holder; units return to the inventory |
| Arranged transfer | Staff arrange a trade between two clients; the seller offers, the buyer accepts |
| Open offer | A client posts an offer any eligible client may take, shown without its maker's name |

**On the site:**
- **The note's answer first.** Before anything is sent the site asks the note whether its leg could
  move, and refuses in words (no note claim, a revoked or lapsed one, a frozen wallet, transfers
  stopped).
- **The buyer's cash first.** Placement reads the buyer's deposit and refuses when it is less than
  the price, saying where the bank credits it. A fresh credit is waited for, for about ten
  seconds.
- **Each side acts as itself.** A custody account acts through its custodian at once; a client's own
  wallet acts in its browser wallet, which first checks it can pay the fees.
- Offers from the site run for 24 hours; placement defaults to €1,000 a unit.
- **The chain is the record of offers,** read from the contract's events and state; the site keeps
  only which account is whose, and arrangements awaiting a wallet.
- **Cancelling from the inventory** is a Tier 1 act of the controller, limited to units the
  inventory holds unoffered (record 0015).

## Consequences

- No party is ever exposed to delivery without payment.
- Settlement never moves who is the holder of record before it settles, so distributions are
  unaffected by offers in flight.
- A redemption ends every open offer on the note.
