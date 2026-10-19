# 0025. The Ledger, reconciliation and the audit log

- **Status:** Accepted
- **Date:** 16 October 2026

## Context

The bank's reviewers must be able to see everything instructed on the chain, read in plain terms,
with nothing quietly missing. The desk must be able to show, for any note on any day, that the
chain and its books agree, and to know which person did what on the site.

## Decision

**The Ledger,** for every approved user: the deployment's lifecycle reconstructed from the chain,
transaction by transaction.
- **An audit tape of calls,** decoded from each transaction's calldata.
  - A call is identified by the contract it was sent to and its selector together, since two tokens
    share `transfer` and `approve`.
  - Nothing is dropped: a call the tape does not know is shown as an unrecognised row, with its
    selector and calldata. A browser test fails if a fresh deployment's Ledger shows one.
  - Amounts are formatted in their own token's decimals, and written reasons are shown whole.
  - Calls through a custody account are unwrapped, one row per inner call.
- **Read from the deployment's first block,** found by binary search on when its identity storage
  first has code, through the ledger RPC (`LEDGER_RPC_URL`: Alchemy on Ethereum Sepolia, whose log
  queries take the whole range), and cached for a minute while no new block lands.
- **Only the deployment's own contracts** are read on a public network; shared ones (the pool
  manager, Permit2, WETH, the payment token, the Safe factory) carry everyone's traffic. Custody
  accounts are learned from their factories' events.

**The register reconciliation,** for staff on the Ledger: every account the chain or the site
knows, what each says (identity, claims, balances, the site's client, route and status), and where
they differ, flagged.

**A reconciliation statement for every note,** on the factory's record, as at any moment:
- **As at** the close of a day (its last block, UTC; "so far" on the current day), now, or a given
  block. Every figure is read at that one block, from the chain's state and the event index up to
  it, so anyone with the chain can reproduce it.
- **Positions** for every account the note ever moved: units in and out, balance, units locked by
  open offers, eligibility at the block, coupons and redemption paid, anything held.
- **Cash:** what the Paying Agent and the settlement contract hold, the Agent's funding, the
  Issuer's inventory; every distribution's units paid of those entitled; every open offer.
- **Checks on any day:** the supply is the sum of the balances; every position reconciles; every
  holder is eligible; the locked units are the open offers'; the Paying Agent holds exactly what it
  owes; the settlement contract holds no cash between settlements; the term sheet matches the note.
- **Once redeemed, the close-out's checks:** supply zero; terminated and paused; no holder left;
  every distribution paid; nothing held; no cash left in the Paying Agent; no open offer or locked
  unit. "Closed" only when every check passes; otherwise "Redeemed, not closed", or for a live note
  "Reconciled" or "Not reconciled", with the failing checks named.
- Downloaded on demand as JSON (every figure and check) or CSV (positions, for the bank's tools).
  Nothing is stored, so nothing can drift from the chain.

**The audit log** records every act on the site: who, what, and on which subject, including
automatic approvals and failed jobs. It belongs to the bank, not a deployment, and is kept across
deployments. The Agent's portal shows the latest 200 entries.

| Option | Chosen? | Why |
|---|---|---|
| Statements built from the chain on demand | Yes | Reproducible by anyone, and nothing to drift |
| Statements stored when produced | No | A stored figure can disagree with the chain |

## Consequences

- A gap in what the tape can decode is visible, not silent.
- Any day's statement is the same each time it is built.
- The evidence for a note's life, from issuance to close-out, can be produced by anyone with
  access to the chain.
