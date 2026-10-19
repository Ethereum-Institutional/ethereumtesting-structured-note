# 0012. Distributions through the Paying Agent

- **Status:** Accepted
- **Date:** 16 October 2026

## Context

Coupons, early redemptions and final redemptions are paid in the tokenized deposit to the holders
of record. The Register is the golden source of who holds; the chain must verify it, so that a
Register that omits a holder cannot close an event and one that invents a holder cannot be paid.
Funding must be separable and reconcilable note by note, while the Agent's account stays pooled.

## Decision

**`PayingAgent`, one clone per note.**

- **Opening** an event, after its payment date: the amount per Calculation Amount comes from the
  accepted determination; the units entitled are the note's supply at the Record Time less the
  Issuer's inventory; the whole amount is drawn from the Agent's deposit account in one transfer.
  Opening a redemption also pauses the note.
- **Paying** takes holders in batches. Each holder's units are its balance at the Record Time,
  read from the record-date module, never a figure supplied with the call. A holder is paid once
  per event; the inventory never. At a redemption, the holder's units are burned as it is paid.
- **Closing** is automatic, when the units paid equal the units entitled. At a redemption, the
  inventory's units are burned on closing, not paid.
- **A holder the deposit cannot credit** (a lapsed or revoked claim) is not skipped: its amount is
  held in the Paying Agent against it and the event, and anyone may claim it for the holder once
  the deposit accepts it again. The event still closes for everyone else.
- **Amounts** are the amount per Calculation Amount times the holder's units, so the total paid is
  exactly the amount drawn, with nothing to allocate. A custody account is paid as the holder of
  record.

**Roles are the programme's,** read from the governance controller at each act:
- the servicing wallet opens and pays;
- the funder's account (the Agent's) is drawn from;
- the controller alone reverses and restates (record 0016).

**Funding by an exact approval when the event opens.**

| Option | Chosen? | Why |
|---|---|---|
| An approval of exactly the event's amount, given when it opens | Yes | The Agent's account stays pooled, yet each note draws only what is due, and each draw reconciles to one event |
| A pre-funded balance per note | No | An extra transfer per event, and cash idle in every note |
| A standing approval | No | Funding could be neither separated nor reconciled per note |

**On the site,** a payment is a background job (record 0022), proposed by someone with the
payments duty and approved by a second (record 0021):
1. the Agent's key approves the Paying Agent for exactly the event's amount;
2. before a redemption, any open offers on the note are released, since frozen units cannot be
   burned;
3. the servicing wallet, a two-of-three Safe, opens the event and pays the holders of record in
   batches of 40. Two owners' keys the site holds sign each wallet transaction.

Holders are found from the note's own transfers in the event index, with units read at the Record
Time, so the Register the site pays from is the chain's. Held amounts are claimed from the note's
page once the holder can receive.

## Consequences

- An event cannot close with a holder missing or an amount mis-stated.
- Every draw on the Agent's account names one note and one event.
- Rotating the servicing wallet or the funder is one Tier 2 act for the whole book.
