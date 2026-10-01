# 0072. Demonstration notes: a second note on the same code, a calendar chosen at issuance, scenario levels, site-held test keys, and Reg S approval per client

- **Status:** Accepted (owner, 1 October 2026)
- **Date:** 1 October 2026

## Context

The lifecycle console (S-06 to S-21, S-30 to S-34) needs a note whose dates arrive during a
demonstration. The note on the test network has real quarterly dates, the first on 26 December
2026, so nothing can be determined for three months. The note's gate requires the Reg S flag of
every holder, and onboarding (ADR 0054) never grants it.

## Decisions (each put to the owner with options)

1. **A second, demonstration note.** It runs the same contracts as the note under review: its
   proxy points at the live note's implementation. It has its own gate and lifecycle contracts,
   and a scenario's terms. The live note stays untouched. *Rejected:* the live note on its real
   dates; the local chain only.
2. **The calendar is chosen at issuance, and re-issued to restart.**
   - Staff choose 5, 10 or 30 minutes between four observations.
   - Record and payment times fall a fifth and two fifths of the way to the next observation.
   - The dates are then fixed on-chain like any note's.
   - *Rejected:* an advanceable clock. The owner asked whether the dates could move by a function
     call. They should not. The dates are a control: no determination before its date, no transfer
     after its record time. A function that moves them is a role able to trigger a redemption or
     skip a record date, it would change the frozen code (ADR 0026), and it would be visible
     on-chain. Re-issuing gives the same speed. *Also rejected:* a fixed 10-minute calendar.
3. **The site holds the test-network keys:** the Issuer, the Agent, the Calculation Agent, and two
   of the three owners of the Agent's servicing wallet, which pays. Clients sign their own side of
   a placement or transfer. *Rejected:* every role in MetaMask; servicing-wallet approval in the
   Safe app.
4. **Levels come from a scenario chosen at issuance, editable before each determination.** Five
   scenarios come from the independent payoff model's vectors, each with its expected payments, so
   every determination is checked against the model. *Rejected:* typed levels; a market data feed.
5. **Staff approve each client for the note.** A separate action writes the Reg S flag into the
   client's registry grant, once staff confirm eligibility for the offering. *Rejected:* Reg S at
   onboarding outside the US; the deployment's own investors only.

## How issuance works

Issuance is 17 single transactions, as `IssueNote.s.sol` and `Lifecycle.sol` do it: the gate; the
note's proxy; the Agent's minter role; the Determination Agent, with the terms and the calendar
fixed from that block; the record-date engine, attached through a snapshot role granted and
renounced; the Paying Agent and its burn and pause roles; the DvP settlement contract; their
registry grants; the Agent's funding by bank credit, and its allowance; and the inventory minted to
the Issuer. Each step is claimed before it is sent and recorded when it lands. A step whose
simulation fails sent nothing, and is tried again on the next call. The Operator page drives it and
shows each step.

## Consequences

- The site deploys from `site/lib/notes/artifacts.json`, exported from the instruments' build by
  `scripts/export-note-contracts.mjs` and committed. The note's implementation is never deployed again.
- A demonstration note's admin is the Issuer's key. It is not handed to the governance
  controller, which governs the note under review. Tier 2 acts on a demonstration note are out of scope.
- The lagging-RPC tests found two hazards, now handled: reading from a contract just after its
  deployment (role identifiers are read from the live note), and estimating a transaction against
  a block before the previous step (the step is tried again).
