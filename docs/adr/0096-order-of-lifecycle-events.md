# 0096. The order of lifecycle events, written from the contracts and walked by a test

- **Status:** Accepted, as workstream 9 of 0.2.0
- **Date:** 15 October 2026

## Context

The bank is documenting its own order of lifecycle events in more detail, and the plan asks for a
precise sequence in the overview, fitted to that order when it arrives. The rules that make up the
sequence were all in force already, but they were spread across the contracts, the tests and the
ADRs:
- a date is determined from its date and in turn (D1, P5);
- holders of record are fixed at the Record Time, inclusive (E1);
- transfers stop at a possible redemption (E4);
- payments open from the Payment Date;
- a redemption pauses the note and burns as it pays.

No one document set out the whole order.

## Decision

**One document, `docs/lifecycle-sequence.md`, sets out the order** in six parts:
1. onboarding;
2. issuance;
3. placement and trading;
4. each observation date, in turn;
5. redemption and the end of the note;
6. interventions, and when each may be made.

Each step names who acts, by which call, from when, and what is refused if it is tried out of
turn. A rule that is the site's, not the contracts', says so.

**It is written from what the contracts enforce,** not from a convention. It will be fitted to the
bank's order: each of the bank's steps is mapped to one here, and a step the contracts do not yet
enforce is either added to them or recorded as a procedure outside the chain.

**A test walks it.** `instruments/test/Sequence.t.sol` takes one note through the whole order,
with the document's step numbers. At each step it first tries the step too early or out of turn,
and shows the refusal:
- issued paused;
- placement refused to an ineligible wallet, and after its deadline;
- a determination before its date, and out of turn;
- the Record Time counting a transfer at it and not one after;
- payment before the Payment Date, of nothing due, and to the inventory;
- the stop on transfers at a possible redemption;
- the note terminated, and later dates falling away;
- burning as it pays, including a unit an open offer had locked;
- the untaken offer released once the note is paused.

If a contract changes the order, the test fails and the document must change with it.

The overview takes the document in when it is rewritten (workstream 11).

## Consequences

- **The bank's order** is fitted by mapping, and any gap is named rather than assumed.
- **The order within a date is not more rigid than the contracts make it.** A date may be determined before its Record Time, and transfers then never stop for it unless it redeems. The document says so.
