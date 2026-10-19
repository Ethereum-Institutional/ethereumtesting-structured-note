# 0001. Purpose, audience and these records

- **Status:** Accepted
- **Date:** 16 October 2026

## Context

This repository is a proof of concept for a note programme on a public blockchain. Its audience is
a global bank's agency and trust business: issuing and paying agent, registrar and trustee for a
programme of structured notes. Such a desk issues many notes, sometimes several at once, and
manages each through its life under one governance framework. It needs to show its own staff, its
clients and its reviewers that every control a note relies on is enforced on the chain, and that
the desk can run the book at scale.

The design is made of many decisions. Each needs its reasons kept beside the code, so that it is
not reversed by accident.

## Decision

**What the system is:**
- **A programme, not a note.** One governance controller, one note factory, one identity storage
  and one tokenized deposit serve every note the programme issues (records 0008 to 0017).
- **The bank's cash leg.** Notes settle and pay in a mock of the bank's tokenized deposit
  (record 0006). A conversion pool lets eligible clients move between a euro stablecoin and the
  deposit (record 0018).
- **One identity per client, claims by role.** Each institution vouches for what it is
  responsible for, on the client's ONCHAINID identity (record 0005).
- **A desk on a website.** Staff portals for the bank, the onboarding agent, the Agent and the
  custodians, and pages for clients, run the whole lifecycle (records 0020 to 0026).
- **Written to read as production.** What is deployed and verified on the chain names itself for
  what it does. What is a mock, such as the deposit, says so in the documents, not in the code.

**How these records are kept:**
- One record per topic, describing the system as it stands. When the design changes, the record
  changes with it.
- The code is the authority. Where a record and the code disagree, the code is right and the
  record is corrected.
- Each record gives its context, the decision, and its consequences. Where a choice was made
  between options, a short table says why.
- The records are for the codebase only. Pages, messages and errors explain themselves in plain
  English and never cite a record.
- The bank and its clients are never named in the repository. They are "the bank" or "a global
  bank's agency and trust business". Parties are named by capacity: the Issuer, the Agent, the
  Calculation Agent, the onboarding agent, the custodian.

## Consequences

- A reviewer can read the design here and check it against one place in the code.
- A change to the design without a change to its record is a defect in review.
- `docs/lifecycle-sequence.md` sets out the order of lifecycle events as the contracts enforce it,
  and `instruments/test/Sequence.t.sol` walks that order; the overview and the IT hand-over guide
  describe the same system for their own readers.
