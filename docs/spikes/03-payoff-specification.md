# Spike 3. Payoff specification

Status: complete as a draft for confirmation, 23 September 2026. **Ten items require
confirmation by the Issuer and the Calculation Agent** (section 10). Each carries a stated
default, so implementation can proceed against the defaults and a changed answer changes a
parameter or a clause, not the design.

The client's draft fixes the shape of the payoff: a conditional coupon, Mandatory Early
Redemption tested against the worst performer, and at maturity (A) €1,000 per unit with Twin Win
if applicable, or (B) following a breach, CA × (100% + worst-performer Final Performance). It
does not fix levels, rates or dates, and the working session did not discuss them. This
document therefore settles **semantics**, which must be decided before any Solidity, and leaves
**economics** (barrier levels, rates, dates) as term sheet parameters.

The rules are implemented a second time, independently, in `spikes/payoff/model.py`, in exact
rational arithmetic. That model generates `spikes/payoff/vectors.json`, a grid of 25 scenarios
which the contract must reproduce to the cent (scenario S-34). Clause references below (P, B, R,
S, E, D) are cited by both.

---

## 1. Definitions

| Term | Meaning |
|---|---|
| Calculation Amount (CA) | €1,000. One unit of the note. |
| Underlying | Each reference asset in the basket, indexed from zero in the order fixed at issuance. |
| Initial Level | The Strike Date Closing Level of an Underlying, recorded once at issuance. |
| Level | The closing level of an Underlying on an Observation Date, as determined by the Calculation Agent. |
| Ratio | Level divided by Initial Level. Exact; never rounded. |
| Final Performance | Ratio on the Final Valuation Date, less 100%. |
| Worst Performer | The Underlying with the lowest Ratio on a given date. |
| Observation Date | A scheduled date on which one or more of the coupon, MER and barrier tests apply. |
| Final Valuation Date | The last Observation Date. |
| Record Time | The instant at which holders of record are fixed for a payment. |

## 2. Parameters fixed at issuance

These are term sheet values. The figures in the vectors are illustrative only.

| Parameter | Unit | Illustrative |
|---|---|---|
| Initial Level per Underlying | integer at the published scale | 4,512.00 / 18,203.00 / 250.00 |
| Coupon barrier | bps of Initial Level | 7,000 |
| Coupon rate per coupon date | bps of CA | 250 |
| Memory | yes or no | no |
| MER trigger per MER date | bps of Initial Level | 10,000, optionally stepping down |
| Barrier | bps of Initial Level | 6,000 |
| Barrier observation dates | subset of the calendar | Final Valuation Date only |
| Twin Win | upside participation, downside participation, optional cap, in bps | not applicable |
| Observation calendar | adjusted dates, with the tests applying on each | quarterly, four dates |
| Record Time and Payment Date per event | timestamps | per event |

## 3. Rules

- **P1. Denomination.** One token unit is one CA. `decimals = 0`. A balance is a count of
  Calculation Amounts, so every amount per holder is an exact multiple of the amount per CA.
- **P2. Ratios, not levels.** Every test and every amount depends only on the Ratio of each
  Underlying. The published scale of a level (two decimals, four, eight) cancels, so each
  Underlying's scale is fixed at issuance and every Level for it is given at that scale.
- **P3. Units.** Money in integer euro cents. Barriers, triggers, rates and participations in
  integer basis points.
- **P4. Worst Performer.** Lowest Ratio. On a tie, the lowest index is reported. **Every amount
  depends on the Ratio alone, so the tie-break cannot change a payment**; the index is recorded
  for the audit trail only. Ratios are compared by cross-multiplication, not by division.
- **P5. The calendar is fixed at issuance.** Dates, and the tests that apply on each, are written
  once with the Initial Levels (S-06). A determination supplies Levels for a scheduled date; it
  never supplies a date, a test or a barrier. A worst-of basket requires this, because a calendar
  supplied with each determination could be chosen after the Levels are known.
- **P6. Terms are validated at issuance** and rejected, not repaired: Initial Levels positive;
  barrier above zero and not above 100%; barrier not above the coupon barrier; every MER trigger
  not below the coupon barrier; calendar strictly ordered; exactly one Final Valuation Date, last,
  on which the barrier is always observed; any Twin Win cap not below 100%.
- **P7. Final redemption, per CA.**
  - If a breach has occurred **and** the final Ratio of the Worst Performer is below 100%:
    CA × final Ratio. This is CA × (100% + Final Performance), scenario B.
  - Otherwise, with no Twin Win: CA. Scenario A.
  - Otherwise, with Twin Win, final Ratio at or above 100%: CA × (1 + upside participation ×
    (final Ratio − 100%)).
  - Otherwise, with Twin Win, final Ratio below 100%: CA × (1 + downside participation ×
    (100% − final Ratio)).
  - Any cap applies to the Twin Win amount.
  - The condition "and the final Ratio is below 100%" matters only if the barrier is observed
    before the final date: it prevents a breached note that has recovered from paying more than par
    under scenario B.
- **P8. Coupon, per CA.** CA × coupon rate if the Worst Performer's Ratio passes the coupon test.
  With memory, CA × coupon rate × (1 + the number of consecutive coupon dates missed immediately
  before). A paid coupon resets the count.

## 4. Boundary semantics

The two amounts either side of a boundary differ by a large amount. With the illustrative Twin
Win terms, a Worst Performer exactly at a 60% barrier redeems at €1,400.00, and one level unit
below it at €600.00. Each boundary is therefore stated.

- **B1. Coupon: inclusive.** A Ratio exactly at the coupon barrier pays.
- **B2. MER: inclusive.** A Ratio exactly at the trigger redeems.
- **B3. Barrier: strict.** A breach is a Ratio **below** the barrier. A Ratio exactly at the
  barrier is not a breach.
- **B4. Barrier observation.** On the dates in the barrier observation set only. Default: the
  Final Valuation Date alone. Observation on every scheduled date is supported by the same
  mechanism, by adding dates to the set at issuance. Continuous or intraday observation is not
  supported, because it would require a determination per trading day.

B1 and B3 resolve an exact boundary in the investor's favour. B2 follows the usual "at or above"
wording for an autocall trigger. All three are common wording for this product type and are
defaults, not findings: the Issuer's own term sheet wording governs (section 10).

## 5. Rounding

- **R1. Once, per CA.** The amount per CA is computed exactly and rounded once, to the cent. The
  amount per holder is that figure multiplied by the holder's units. No amount is rounded per
  holder, so the total paid equals the amount per CA multiplied by the units entitled, with no
  residue to allocate and nothing for reconciliation to explain.
- **R2. Nearest cent, half a cent upward.** The model's grid includes an exact half cent
  (49,937.5 cents, paid as 49,938), and a figure either side of a whole cent in each direction.
- **R3. No intermediate rounding.** Ratios are never materialised as rounded numbers. Each amount
  is a single integer quotient (section 9).

## 6. Sequencing

- **S1. In calendar order.** Determinations are accepted for scheduled dates only, one per date,
  in order, and are written once.
- **S2. Within a date: barrier, then coupon, then MER.** The coupon on an MER date is therefore
  paid, and the MER does not also pay it. Holders on an MER date receive CA plus that date's
  coupon, which is the meaning adopted for "par plus accrued" in the solution overview.
- **S3. Termination.** The note terminates at the first MER or at the Final Valuation Date. No
  determination is accepted for any date after termination.
- **S4. Once redeemed, closed.** After a redemption, supply is burned and the register closed
  (S-33). Nothing re-opens it.

## 7. Entitlement

- **E1. Holder of record at the Record Time, inclusive.** The balance after every transaction in
  a block with timestamp at or before the Record Time. A transfer in a block stamped exactly at the
  Record Time counts. A transfer after it does not affect entitlement (S-16).
- **E2. The Issuer's inventory is excluded** from coupons (S-18) and is burned, not paid, at
  redemption.
- **E3. Custody accounts are holders of record** and are paid as nominee (S-17). Entitlement is by
  account, not by beneficial owner.
- **E4. Transfers stop at a redemption Record Time.** From the Record Time of an MER or of final
  redemption, transfers revert. Without this, a transfer between Record Time and Payment Date moves
  units whose redemption belongs to the seller, and the buyer holds units that are then burned
  without payment. Coupons do not stop transfers.

## 8. Determinations

- **D1. The Calculation Agent signs the Levels and the outcome.** A determination carries the
  Levels for a date and the outcome the Calculation Agent computed from them: whether each test
  passed and the amount per CA. The contract recomputes the outcome from the Levels and the terms
  and **accepts the determination only if the two agree exactly**. A disagreement changes no state.
  This makes every payment the product of two independent computations, keeps the Calculation Agent
  the determining party, and leaves on-chain Levels from which any party can recompute the history
  (S-35).
- **D2. Levels are closing levels at the published scale** fixed at issuance per Underlying (P2).
- **D3. Market disruption is off-chain.** Postponement and fallback valuation are the Calculation
  Agent's under the terms. The contract accepts a determination at any time after its scheduled date
  and has no disruption logic of its own.

## 9. Integer formulas for the contract

With I the Initial Level and F the Level of the Worst Performer, CA in cents, and all other terms in
basis points (B = 10,000), each amount is one quotient of non-negative integers. Rounding half up
is `(2n + d) / (2d)` in integer division, for amount n / d.

| Test or amount | Integer form |
|---|---|
| a worse than b | F_a × I_b < F_b × I_a |
| Coupon test, MER test | F × B ≥ barrier_bps × I |
| Barrier breach | F × B < barrier_bps × I |
| Scenario B | CA × F / I |
| Twin Win, F ≥ I | CA × (B × I + up_bps × (F − I)) / (B × I) |
| Twin Win, F < I | CA × (B × I + down_bps × (I − F)) / (B × I) |
| Twin Win cap | min(amount, CA × cap_bps / B), compared before rounding |
| Coupon | CA × rate_bps × periods / B |

With Levels below 2^96 and CA below 2^64, no product exceeds 2^200, so the contract needs no
512-bit multiplication and no intermediate division.

## 10. For confirmation by the Issuer and the Calculation Agent

| # | Question | Default | Where it lands |
|---|---|---|---|
| C1 | Barrier observed at the final date only, or on each scheduled date | Final only | B4, a parameter |
| C2 | Barrier strict, coupon and MER inclusive | As stated | B1 to B3 |
| C3 | Scenario B only if the final Ratio is below 100% | Yes | P7 |
| C4 | Memory on the coupon | No | P8, a parameter |
| C5 | Twin Win: applicable, participation each side, cap | Not applicable | P7, parameters |
| C6 | "Par plus accrued" at MER means CA plus that date's coupon | Yes | S2 |
| C7 | Rounding to the nearest cent, half up, once per CA | Yes; confirm against the Programme conditions | R1, R2 |
| C8 | Record Time definition and inclusivity at the exact timestamp | Inclusive | E1 |
| C9 | Transfers stop at a redemption Record Time | Yes | E4 |
| C10 | The Calculation Agent signs the outcome as well as the Levels | Yes | D1 |

C7 and C8 should be checked against the Programme's own conditions before being put to the
Calculation Agent, since the Programme may already answer them.

## 11. Evidence

`spikes/payoff/`: the model, the vector generator, the committed vectors, and 15 tests, all
passing. The tests are of two kinds:
- **Hand-computed figures for every clause, independent of the model's code.** These cover the
  barrier exactly at and either side, the coupon and MER at and one unit below, a step-down trigger,
  ties, the exact half cent, rounding each way, a Level of zero, breach and recovery under
  observation on every date, memory, and Twin Win above, below, at the barrier, below it and capped.
- **Properties.** Redemption is monotone in the worst Ratio. A breached note never pays above par.
  **Amounts are invariant under every reordering of the basket**, checked on all 25 scenarios. The
  distribution is exact. Invalid terms are rejected. The committed vectors match the model.

Run with `python3 -m unittest -v` in `spikes/payoff/`. After any change to the model or the grid,
regenerate with `python3 vectors.py > vectors.json`.
