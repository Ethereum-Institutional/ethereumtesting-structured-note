# 0092. The bank's acts on its deposit: debit, hold, pause and a move by order, on a Deposit page

- **Status:** Accepted (owner, 15 October 2026), as workstream 5 of 0.2.0
- **Date:** 15 October 2026

## Context

ADR 0086 settled the tokenized deposit's design, and workstream 1 built it:
- an allowlist ERC-20 that reads the bank's own identity registry;
- the gateway's credits and debits against single-use booking references;
- freezing and forced transfer by ERC-7943;
- pausing.

The plan asks for a deposit "credited and debited by the bank". The bank's portal could credit an
onboarded client, and nothing more: no debit, no hold, no pause, and no view of the deposit as a
whole. Forced transfer was held only by the Paying Agent, for reversing a distribution.

## Decision

### Which acts: debit, hold, pause, and a move by order

The bank's portal now carries all four. The owner chose debit, hold and pause as recommended, and
added a forced transfer by the bank.

- **Debit.** The bank pays a client's deposit back out to its account at the bank. The gateway extinguishes it against a booking reference, the mirror of a credit.
- **Hold.** ERC-7943's `setFrozenTokens` holds part of a balance, for a dispute or an order. A held amount cannot move or be debited. The amount set is the whole amount held, and zero releases it.
- **Pause.** Every transfer, credit and debit stops at once, and with them the pool and settlement. A move by order still proceeds.
- **A move by order:** the new `enforce(from, to, amount, reason)`.
  - **The bank alone,** by a role of its own, `ENFORCER_ROLE`, distinct from ERC-7943's `FORCED_TRANSFER_ROLE`, which stays with the Paying Agent for reversals.
  - **Its written reason is required,** and is emitted in full, so the order can be read on the chain.
  - **It proceeds held or paused,** as a forced transfer does. It never delivers to an account that cannot receive, and never extinguishes: a debit does that, against its booking.

### How a wrong holding is corrected: a debit and a credit, booked

The owner chose this as recommended. A correction is a debit from one account and a credit to
another, each against its own booking reference, so every correction pairs with its core-banking
entries.

The owner also chose to give the bank a forced transfer. The two are kept apart:
- **corrections** go through bookings;
- **a move by order** is for what the bank must move because a court or a regulator says so, and records the order as its reason.

### Where: a Deposit page in the bank's portal

The owner chose this as recommended. `/bank/deposit` shows the deposit as one moment of the chain:
every log and state read is pinned to the same block, so a node a block behind cannot show a booking
whose balance it does not yet show. It shows:
- **the deposit:** what is outstanding, and whether it is moving or paused;
- **every holder:** its balance, the amount held, and why it may hold, by the bank's claim or by the allowlist, with the bank's acts on its row;
- **the bookings:** each credit and debit, with the reference the site assigned where the site made it, or its hash where it did not;
- **the moves by order,** each with its reason.

Crediting stays on the onboarding rows too.

## Consequences

- **The deposit gains** `ENFORCER_ROLE`, `enforce` and the `Enforced` event. The scaffolding grants the role to the bank, and the tape names the act.
- **Each act's reason** is in the site's audit log; a move by order's is on the chain as well. The booking references the site assigns are in the audit log too, so the Deposit page names every booking the site made.
- **Tests:**
  - Foundry: the bank's move by order, with its reason, held and paused, never to nowhere, and by the bank alone;
  - `site/test/deposit.integration.ts`: credit, debit, the hold, the pause, a move by order, and the bank's view, through the lagging RPC;
  - the browser spec `06-deposit.spec.ts` clicks every act on the Deposit page.
- **The bank's identity registry** for the deposit is unchanged (ADR 0086). This workstream adds acts on the token, not a new way to become eligible.
