# 0115. A note programme for an agency and trust business

- **Status:** Accepted, the basis of release 0.3.0
- **Date:** 16 October 2026

## Context

The audience is a global bank's agency and trust business, running a note programme: many notes,
sometimes several issued at once, each managed through its life under one governance framework. A
review of 0.2.0 against that found a design built around one demonstration note (plan 0.3.0, "Why").
The owner chose to address every finding.

## Decision

**What the programme is:**
- **One governance controller,** whose acts name the note.
- **The Issuer only issues,** from its multi-signature wallet.
- **One register of roles,** so a rotation is one act.
- **Issuance that is cheap and batched.**
- **Supervision across the book.**
- **A governed identity storage.**
- **Per-note funding and identifiers.**
- **A desk run by background jobs,** with a book view, roles per function and an index of the chain.

**The owner's answers to the six questions put:**

| Question | Chosen | Not chosen, and why |
|---|---|---|
| How a note's lifecycle contracts are deployed | Minimal clones per note, so one note's fault cannot touch another's balances | One programme Paying Agent and settlement: cheapest, but a fault or pause there would reach the whole book |
| Who owns the factory | The Issuer's multi-signature wallet: two of three signers issue | The Issuer's single key: one compromised key could issue. The controller: it would put the decision to issue in the agent's hands |
| How a distribution is funded | An exact approval when it opens | A pre-funded balance per note: an extra transfer per event, and cash idle in each note. A standing approval: funding can be neither separated nor reconciled per note |
| When a determination may be corrected | At any time, through Tier 2. Once paid, reversed and restated holder by holder | Only before payment: wrong payments could not be corrected on the chain. Never: a Calculation Agent's error could not be fixed at all |
| How a note is identified | A programme series ID the factory assigns, and an ISIN when staff enter one | Series ID only: no market identifier. ISIN only: test notes would need invented ISINs, and issuance would fail without one |
| Which acts need a second person | Determinations and payments | Issuance and Tier 1 acts already need their wallets' own signatures |

## Consequences

**A fresh deployment.** The 0.2.0 controller, factory, deposit and gateway cannot be upgraded or
handed on, so 0.3.0 is a fresh deployment on Ethereum Sepolia. Notes, clients and onboardings start
again; registrations remain.

**The records.** Once 0.3.0 is built, the decision records are consolidated into a current set,
and this record is folded into them.
