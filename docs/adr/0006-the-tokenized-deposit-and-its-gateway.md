# 0006. The tokenized deposit and its gateway

- **Status:** Accepted
- **Date:** 16 October 2026

## Context

Notes settle and pay in the bank's tokenized deposit: a liability of the bank, created on credit
to a client's account and extinguished on debit. The bank must alone decide who may hold its cash,
and must be able to act on it as it does on any account: credit, debit, hold, pause, and move by
order.

## Decision

**`DepositToken`, "Euro Tokenized Deposit" (`EURTD`), two decimals,** an OpenZeppelin ERC-20
shaped like the one bank deposit token whose source is public, with ERC-7943's freeze and forced
transfer.

- **Who may hold it:** an account the deposit's own identity registry verifies, through the
  bank's `claim.deposit-eligible`; or one on an explicit allowlist, which is for contracts: each
  note's Paying Agent and settlement contract, and the pool's adapter and Permit2.
- **Every transfer checks sender, receiver and spender.** A contract moving the deposit under an
  allowance must itself be eligible.
- **Roles:**

| Role | Holder | What it does |
|---|---|---|
| Mint, burn | The deposit gateway alone | Credit and debit |
| Pauser, freezer, allowlist | The bank | Pause everything; hold part of a balance; allowlist contracts |
| Allowlist | The note factory | Allowlists each note's Paying Agent and settlement contract as it issues |
| Enforcer | The bank | `enforce(from, to, amount, reason)`: a move by court or regulator's order, its reason emitted in full |
| Forced transfer | Each note's Paying Agent | Recovers a reversed coupon (record 0016) |
| Admin | The governance controller | Grants and revokes the roles above, by Tier 2 act only |

- **A forced transfer or a move by order** proceeds while paused or held, never delivers to an
  account that cannot receive, and never extinguishes: a debit does that.
- **Pausing** stops every transfer, credit and debit, and with them settlement and the pool.

**`DepositGateway`** stands in for the bank's deposit service. It alone mints and burns, operated
by the bank as Deposit Agent. Every credit and debit carries a booking reference, single-use, so a
booking replayed by mistake cannot credit twice. The site assigns references (`BKG-…`).

**The bank's acts, on its Deposit page:** credit, debit, hold, release, pause, and move by order.
The page reads one block for everything: the supply, every holder with its balance, amount held
and why it may hold, every booking, and every move by order with its reason. A wrong holding is
corrected by a booked debit and credit, not by a forced move.

**Left out:** a production deposit token's cap, timelock on allowlisting and upgradeability. A mock
needs none of them, and the documents say so.

## Consequences

- The note's and the deposit's eligibility are separate decisions by separate institutions, on
  the same identity.
- No one but the controller can change the deposit's roles, and only by a Tier 2 act (record 0015).
- Every on-chain credit and debit pairs with a booking the bank can reconcile.
