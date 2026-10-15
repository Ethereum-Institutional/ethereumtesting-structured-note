# The order of lifecycle events

The sequence of a note's life, step by step: who acts, by which call, from when, and what is refused
if it is tried out of turn. Each rule is the contracts' own unless it says it is the site's; `instruments/test/Sequence.t.sol`
walks one note through every step in this order, trying each too early or out of turn first, with
the step numbers used here (ADR 0096).

It is written from what the contracts enforce today, ready to be fitted to the bank's detailed
order of events when it arrives.

**Times.** Each observation date *k* has three instants, fixed at issuance in the term sheet
(ADR 0095) and never moved afterwards (P5):

| Instant | In the term sheet | On the illustrative note |
|---|---|---|
| Observation date | `calendar[k].date` | quarterly from issuance |
| Record Time | `calendar[k].recordTime` | two days after the date |
| Payment Date | `calendar[k].paymentDate` | five days after the date |

Times are the chain's own block times, in UTC.

---

## 1. Onboarding: before a client may hold anything

| Step | Who | What | Refused if |
|---|---|---|---|
| 1.1 | The bank | Creates the client's ONCHAINID identity, managed by whoever holds the wallet's key, and registers the wallet against it | The wallet is already registered |
| 1.2 | The identity's manager | Records the client's consent: a claim key for each institution that will vouch | — |
| 1.3 | The bank | Vouches with its deposit claim: the client may hold the deposit | No consent to the bank |
| 1.4 | The onboarding agent | Vouches with its note claim: the client may hold the note | No consent to the onboarding agent |
| 1.5 | The bank (optional) | Admits the client to the conversion pool with its pool-access claim (ADR 0090) | The deposit does not accept the wallet |

Claims lapse on their own (at most a year; ninety days for pool access) and are revoked at once by
the institution that gave them. A wallet whose note claim is missing, lapsed or revoked cannot
receive the note at any later step.

## 2. Issuance: one act of the Issuer, then the bank's and the Agent's

| Step | Who | What | Refused if |
|---|---|---|---|
| 2.1 | The Issuer | Issues the note through the note factory, in one transaction, from its term sheet: terms, record dates, the T-REX suite, the term sheet's hash on the note's identity, the Paying Agent, the settlement contract, each agent restricted to its own powers, the notional minted to its inventory, and the note opened (ADR 0091) | Not the factory's owner; the term sheet invalid; the inventory not eligible for the note |
| 2.2 | The bank | Allowlists the Paying Agent and the settlement contract for its deposit, in one call | Not the bank |
| 2.3 | The bank | Credits the Agent's deposit account, to fund distributions | — |
| 2.4 | The Agent | Lets the Paying Agent draw its deposit | — |

Until the note is opened (2.1), nothing moves: the note is issued paused.

## 3. Placement and trading: while transfers are open

| Step | Who | What | Refused if |
|---|---|---|---|
| 3.1 | The Issuer, or a holder | Offers units for sale, or to buy, at a price, until a deadline. Offered units are locked to the seller | Units not held free of other locks; no allowance |
| 3.2 | The counterparty | Accepts: both legs settle in the one transaction, the note against the deposit | The deadline has passed; the buyer not eligible for the note; the cash leg refused by the deposit; transfers stopped (4.2) |
| 3.3 | The Issuer | Buys units back into its inventory by the same means | As 3.2 |
| 3.4 | The Agent | Cancels units from the Issuer's inventory by burning them, its only power on the note | By the site, before anything is sent: more than the inventory holds unoffered (S-14). The note itself limits the Agent to burning |
| 3.5 | Holders | Transfer between eligible accounts | Either account not eligible; transfers stopped (4.2) |

## 4. Each observation date, in turn

The dates are taken in order. A date is not reached until the one before it has been determined.

| Step | When | Who | What | Refused if |
|---|---|---|---|---|
| 4.1 | From the observation date | The Calculation Agent signs; anyone submits | The determination: the Levels, and the outcome the contract computes from them, signed by the Calculation Agent | Before the date; not the next date; the outcome disagrees with the contract's own; the signature is not the Calculation Agent's; the note has terminated |
| 4.2 | At the Record Time | — | The holders of record are fixed: every balance after the transactions in blocks stamped **at or before** the Record Time (E1). If the date could redeem the note (an MER test, or the final date) and is not yet determined, **transfers stop from the Record Time until it is**: ordinary and forced transfers alike (E4) | — |
| 4.3 | From the Payment Date | The Agent's servicing wallet | Opens the distribution: the units entitled are the supply at the Record Time less the Issuer's inventory (E2), and the whole amount is drawn from the Agent's deposit in one transfer | Before the Payment Date; the date not determined; nothing of that kind due; already open |
| 4.4 | After opening | The Agent's servicing wallet | Pays the holders of record in batches, each its balance at the Record Time. A holder the deposit cannot credit (its bank claim revoked, or the deposit paused) is **held for**, not skipped | The inventory; an account that held nothing at the Record Time; a holder already paid |
| 4.5 | When every entitled unit is paid | — | The distribution closes by itself | — |
| 4.6 | Any time after | Anyone, for the holder | Claims an amount held, once the deposit accepts the holder again | Nothing held; the deposit still refuses the holder |

**The order within a date is free where the contracts allow it.** A date may be determined before
its Record Time; transfers then never stop for it unless it redeems. A determination after the
Record Time reopens transfers if the date does not redeem.

## 5. Redemption and the end of the note

| Step | When | Who | What | Refused if |
|---|---|---|---|---|
| 5.1 | A determination that redeems: an MER, or the final date | As 4.1 | The note terminates. Transfers stay stopped for good, and the dates after it fall away | Any later determination (`Terminated`) |
| 5.2 | From that date's Payment Date | The Agent's servicing wallet | Opens the coupon, if due, and the redemption. Opening the redemption pauses the note | As 4.3 |
| 5.3 | After opening | The Agent's servicing wallet | Pays each holder of record, **burning its units as it is paid**, including any locked by an open offer | As 4.4 |
| 5.4 | When every entitled unit is paid | — | The redemption closes, burning the Issuer's inventory. The supply is zero | — |
| 5.5 | Once the note is paused | Anyone | Releases an offer left open, whatever its deadline | The offer is not open |
| 5.6 | Then | Anyone | The reconciliation statement says **Closed**: every position at zero, every distribution paid, nothing held (ADR 0094) | — |

## 6. Interventions, and when each may be made

| Act | Who | When | Refused if |
|---|---|---|---|
| Correct the register by a forced transfer, with a written reason | Tier 1: the Agent's governance wallet, through the controller | While transfers are open | Transfers stopped (4.2, 5.1) |
| Recover a lost wallet's units and identity to a new wallet | Tier 1 | While transfers are open | Transfers stopped |
| Freeze or unfreeze an account on the note | Tier 1 | Any time | — |
| Reverse a closed coupon, holder by holder, and restate it against a corrected Record Time | Tier 2: two institutions, four signatures, after the delay | After the coupon has closed; a restatement only after its corrected Record Time | The coupon not closed; the Record Time not passed |
| Amend the notional in the Issuer's inventory | Tier 2 | Any time | — |
| Hold part of a client's deposit, pause the deposit, or move it by order | The bank (ADR 0092) | Any time; a paused deposit holds payments for 4.4, to be claimed (4.6) | — |
| Withdraw or restore pool access | Tier 1 | Any time | — |

---

**Not yet fitted.** The bank is documenting its own order of events in more detail. When it
arrives, each of its steps is mapped to one here; a step the contracts do not yet enforce is either
added to them, with a step in the walk, or recorded as a procedure outside the chain.
