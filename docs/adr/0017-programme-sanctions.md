# 0017. Programme sanctions

- **Status:** Accepted
- **Date:** 16 October 2026

## Context

When an account is designated under sanctions, it must stop moving on every note at once. Freezing
it note by note would take one act per note, and could be raced while the acts go through.

## Decision

**`ProgrammeSanctions`, one ERC-3643 compliance module that every note carries from issuance.**
- **One list for the programme.** An account the governance controller designates can neither send
  nor receive any note, at once, however many it holds.
- **Designation is a Tier 1 act** of the Agent's governance wallet, with its written reason, and is
  lifted the same way. The module is bound to the controller once, at deployment.
- **Ordinary transfers only.** Issuance into the inventory and burning at redemption are not
  refused, so a designated holder's units can still be redeemed and its payment held for it by the
  Paying Agent. A forced transfer, Tier 1's register correction, is not refused either.
- **Plug and play.** Any note's compliance may bind it; it keeps no state per note.

| Option | Chosen? | Why |
|---|---|---|
| One programme-wide module, one act | Yes | Cannot be raced note by note; one act covers notes issued later too |
| Freezing the account on each note | No | One act per note, and new notes would not inherit the freeze |
| Revoking the client's claims | No | Each institution's own act, not the Agent's; it removes eligibility rather than recording a designation that can be lifted |

## Consequences

- A designation reaches every note, including notes issued after it.
- Freezing an account on chosen notes remains a separate Tier 1 act, for supervision short of
  sanctions.
