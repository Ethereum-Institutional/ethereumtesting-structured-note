# 0010. Terms and determinations

- **Status:** Accepted
- **Date:** 16 October 2026

## Context

The programme's notes are worst-of autocallables on a basket: a coupon when the worst performer is
at or above a coupon barrier, early redemption when it is at or above a trigger, and at maturity
either the Calculation Amount or a loss if a barrier was breached, with an optional Twin Win. What
is paid must follow from the terms and the Calculation Agent's Levels alone, and a single wrong
computation must never reach a payment.

## Decision

**`DeterminationAgent`, one clone per note,** holds the note's terms and accepts determinations
against them. The payoff lives here and nowhere else on the chain.

- **Terms fixed at issuance,** validated, never repaired: initial Levels, Calculation Amount,
  coupon barrier and rate, memory, barrier, Twin Win (participation up and down, and a cap), and
  the schedule of dates, each with its record time, payment date and tests (coupon, early
  redemption with its trigger, barrier, final). Nothing sets them afterwards.
- **A determination supplies Levels for the next scheduled date,** never a date, a test or a
  barrier, and only once the chain's time has passed that date. Dates are determined in order,
  once each, until the note terminates; later dates then fall away.
- **Two computations must agree.** The Calculation Agent signs, by EIP-712, the Levels and the
  outcome it computed. The contract recomputes the outcome and accepts the determination only if
  the two are identical. A disagreement changes nothing.
- **Integers only.** Every test is a cross-multiplication and every amount a single quotient,
  rounded once per Calculation Amount, to the nearest cent, half upward.
- **The Calculation Agent is the programme's:** its address is read from the governance
  controller's register of roles at each determination, so one Tier 2 act rotates it for every
  note. A contract account may sign, by EIP-1271.
- **No disruption logic.** A determination is accepted any time after its date.
- **The Levels stay on the chain,** so anyone can recompute the whole history.
- **Correction** of the latest determination is a Tier 2 act (record 0016).

**The specification and a second implementation.** `docs/spikes/03-payoff-specification.md` states
the payoff clause by clause. `spikes/payoff/model.py` implements it a second time, independently,
and generates the test vectors the contract's tests check against. The specification's positions
on the open points (barrier observation, boundaries, memory, Twin Win, rounding, record time
inclusivity, the transfer stop, the Calculation Agent signing the outcome) are put to the Issuer
and the Calculation Agent for confirmation; each is a parameter or a single place in the code.

**On the site:**
- A note issued from a scenario carries the scenario's Levels for each date, pre-filled and
  editable. Five scenarios come from the model's vectors; on a four-date note each outcome is
  shown against the model's expected payments.
- A determination is proposed with its Levels and where they came from, checked at once against
  the contract's own computation, approved by a second person with the Calculation Agent duty
  (record 0021), then signed and sent with the Calculation Agent's key.
- A note's calendar is chosen at issuance: 1 to 12 observations, minutes to months apart, for at
  most ten years. Each record time falls a fifth of the way to the next observation and each
  payment date two fifths, at most 2 and 5 days after it. The dates are then fixed like any
  note's: there is no clock to advance.

## Consequences

- A wrong Level is caught by the second approver, a wrong computation by the contract.
- Every payment is the product of two independent computations.
- A note uploaded from a term sheet has no scenario, so the site has no model to check its
  outcomes against; the contract's own recomputation still applies.
