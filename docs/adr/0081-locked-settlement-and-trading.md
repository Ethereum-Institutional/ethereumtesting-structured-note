# 0081. Locked settlement: offers that lock their side, transfers arranged or open, buy-backs, and cancelling from the inventory

- **Status:** Accepted (owner, 1 October 2026)
- **Date:** 1 October 2026

## Context

Part 4 covers these scenarios:
- S-11: transfer between approved investors;
- S-12: a revoked counterparty is refused;
- S-13: buy-back into the Issuer's inventory;
- S-14: reducing the total by no more than the inventory;
- S-16: entitlement fixed at the record time.

The DvP settlement contract (ADR 0013) already settles both legs atomically, with a deadline and cancellation. But a proposer's assets stay spendable until acceptance, so a counterparty can find the trade fails. The owner asked for an escrow: a client locks its note or its deposit, the other side supplies the other leg before a timelock, and either can cancel before then.

Known patterns:
- **HTLCs:** built for swaps across two chains.
- **OTC escrows** (AirSwap, 0x OTC orders): the escrow contract takes custody of both legs.
- **ERC-3643's delivery-versus-delivery manager:** allowances, with no lock.

A custodial escrow breaks two of the note's rules:
- settlement contracts may not hold the note (ADR 0013);
- a holder of record must be the owner, or the escrow would be paid the coupon.

## Options

1. **Lock in place:**
   - selling freezes the seller's units in its own wallet, using the debt standard's partial freeze (ERC-7551 enforcement);
   - buying has the price held by the contract;
   - cancelling, or the deadline passing, releases the lock.
2. **Today's DvP, unlocked.**
3. **A classic escrow holding both legs.**

And for counterparties:
- (a) named or open, chosen per offer;
- (b) bank-arranged only;
- (c) open only.

For buy-backs: the Issuer offers and the holder accepts. For S-14: staff cancel from the inventory.

## Decision

Option 1 with (a), chosen by the owner, in a new contract, `LockedSettlement`, deployed for each note issued from now on:
- **`offer(side, counterparty, units, price, deadline)`** locks the proposer's side.
  - An offer to sell freezes the units in the seller's own wallet: they stay its units, so it remains the holder of record. It needs the note's allowance for delivery, and refuses more units than are unlocked.
  - An offer to buy has the deposit moved to the contract, as the Paying Agent holds a distribution's cash.
  - A zero counterparty makes the offer open to anyone the instruments accept.
- **`accept`** is made by the named counterparty, or by anyone for an open offer, before the deadline.
  - It unlocks, asks both instruments' `canTransfer`, and moves both legs, or reverts and changes nothing.
- **`cancel`** is made by the proposer, or by a named counterparty declining.
- **`release`** may be called by anyone, past the deadline or once the note is paused.
  - Opening a redemption pauses the note. Frozen units cannot be burned, so the site releases open offers before paying a redemption.
- **Its rights:**
  - the note's `ERC20ENFORCER_ROLE`, granted at issuance by the Issuer's key, which is the admin of a note issued here;
  - from the registry, the settlement right plus hold, receive and transfer, which is what the deposit's gate requires. It never gets the Regulation S flag, so it can never hold or receive the note.
- **Unlocking:** it never unfreezes more than is still frozen, so an enforcer's own unfreeze cannot trap an offer.

On the site:
- **Placement:** the Issuer's named offer to sell.
- **Buy-back (S-13):** the Issuer's named offer to buy; the units return to the inventory.
- **Transfers:**
  - Staff arrange them on the note's page, as the clients' broker.
  - A custody side acts at once through the custodian.
  - A client's wallet acts in MetaMask on its Notes page. Between two wallets, the arrangement waits for the seller's offer.
  - Clients also post open offers to sell or buy. Any approved client may take one, shown without its maker's name. Staff can take an open offer for a custody account.
- **Cancelling from the inventory (S-14):** the Agent burns units from the inventory. Asking for more than the inventory holds unoffered is refused.
- **The note's answer first:** before anything is sent, the note is asked about the movement. A revoked or lapsed grant is refused as S-12, and a missing Reg S flag as S-09.
- **The record:** the chain is the record of offers, from the contract's events and state. The site keeps only arrangements awaiting a wallet.

## Consequences

- Notes issued before this decision (Series 2 on Base Sepolia) keep `DvPSettlement`. They can be placed but not traded, and the page says so.
- The note under review needs a Tier 2 approval to reduce its total. Notes issued here use the Agent's burner role, granted at issuance.
- A buy offer whose proposer later loses its grant cannot be refunded until the grant is live again. Cancel and release revert meanwhile.
- Tested:
  - Foundry, `LockedSettlement.t.sol` (10 tests): locks both ways, named and open, refusals, cancel and decline, release by deadline and by pause, the holder of record, and an enforcer's unfreeze;
  - site integration tests for S-11 to S-14 and S-16;
  - browser spec `12-trading`.
