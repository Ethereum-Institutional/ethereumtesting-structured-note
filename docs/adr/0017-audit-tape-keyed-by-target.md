# 0017. The audit tape is keyed by target and never drops a row

- **Status:** Accepted (Wave 1, during the build)
- **Date:** 24 September 2026

## Context

The inherited activity feed keyed calls by function name alone and silently dropped any it did not
recognise. With two ERC-20-shaped tokens, `mint` and `transfer` are ambiguous.

## Options considered

| Option | Summary |
|---|---|
| Key by target contract and selector; keep unknowns | Unrecognised calls become marked rows with their calldata. |
| Key by function name; drop unknowns | As inherited. |
| Show raw calldata only | No decoding. |

## Decision

Key every call by the contract it was sent to and its selector; show unrecognised calls as marked rows; format amounts in their own token's decimals; never truncate text.

## Why

An audit tape that is quietly incomplete is the worst failure for this audience. Raw calldata is
complete but unreadable. An integration test now fails if any call on a fresh deployment is
unrecognised, so a gap in the registry is caught when it is introduced.

## Consequences

- Transactions are located by the events watched contracts emit, so a reverted attempt does not
  appear. Stated in the code; closing it needs an indexer, a Wave 3 console decision.
