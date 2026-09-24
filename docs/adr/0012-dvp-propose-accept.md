# 0012. DvP settlement is propose, then accept

- **Status:** Accepted (Wave 3, L4)
- **Date:** 24 September 2026

## Context

Placement, secondary transfer and buy-back all settle through one delivery-versus-payment
primitive, with both legs tested before either moves.

## Options considered

| Option | Summary |
|---|---|
| Propose, then accept | One party records the trade, the other accepts, which settles both legs. |
| Two signatures, one submission | Both parties sign off-chain; anyone submits. |
| Agent settles | The Agent executes on the parties' instruction under allowances. |

## Decision

One party proposes on-chain; the counterparty accepts, which settles both legs atomically. Either may cancel before.

## Why

Both instructions are separate acts on the record, which is what an audit trail needs, and custody
accounts take part through their existing call path. Off-chain signatures leave intent off-chain
until settlement; an Agent-settled model makes the Agent a party to every trade.

## Consequences

- The refused leg is named when a settlement fails, and nothing moves.
- Buy-back returns notional to pending with no further instruction.
