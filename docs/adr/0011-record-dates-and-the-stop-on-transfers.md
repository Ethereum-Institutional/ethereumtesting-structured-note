# 0011. Record dates and the stop on transfers

- **Status:** Accepted
- **Date:** 16 October 2026

## Context

Each distribution is owed to the holders of record at its Record Time. The chain must know every
holder's balance at any past instant, without a snapshot transaction that must land on time. And
when a date could redeem the note, no one should be able to buy units after the Record Time that
will then be redeemed away from them.

## Decision

**`RecordDateModule`, one clone per note,** is an ERC-3643 compliance module on the note.

- **Holder of record at the Record Time, inclusive.** The note's compliance calls the module after
  every mint, burn and transfer, and it checkpoints the balances changed, and the supply, at the
  block's timestamp. A later change in the same second replaces the checkpoint, so the balance at
  time *t* is the balance after every transaction in a block stamped at or before *t*.
  `balanceAt` and `totalSupplyAt` read them.
- **Transfers stop at a redemption Record Time.** From the Record Time of any date that could
  redeem the note (an early-redemption date or the final date), an ordinary transfer is refused,
  until that date's determination shows it does not redeem, and for good once one does. The rule is
  the Determination Agent's `transfersOpen`, so no transaction has to land on time.
  - Ordinary transfers are refused by the compliance check before they move.
  - A forced transfer skips that check, so the module refuses it after the move, which undoes it.
  - Mints and burns are unaffected, so the redemption itself proceeds.
- **Recovery** of a lost wallet moves units without calling compliance. The governance controller
  calls `sync` in the same transaction, which records the accounts' balances as they are; anyone may
  call it, since it records only what is true.
- **One module for one note:** it binds to the first compliance that binds it, and no other.

**Opening a redemption also pauses the note** (record 0012), so the note's own views agree with the
stop the module already applies.

## Consequences

- No snapshot transaction exists to be late, missed or front-run.
- A buyer after a redemption Record Time cannot be left holding units that were redeemed away.
- The settlement contract freezes units in the seller's own wallet rather than taking them, so an
  open offer never changes who is the holder of record (record 0013).
