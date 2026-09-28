# 0051. An integration deployment on the test network, separate from the PoC execution

- **Status:** Accepted (owner, 25 September 2026)
- **Date:** 25 September 2026

## Context

The QR flow writes grants on the test network (ADR 0048), and no pool is deployed there. D17
gates testnet execution of the PoC on internal assurance review.

## Options considered

| Option | Summary |
|---|---|
| A separate integration deployment now | Fresh keys for every capacity; labelled as integration testing; the execution deployment still waits for assurance. |
| Wait for assurance | The QR flow can be tested only against a fork, which the holder wallet cannot reach. |

## Decision

Deploy the whole stack to the test network as an integration instance, with keys generated for
it and held outside the repository, never the local node's published keys (ADR 0041). Its
manifest and its deployment record say integration, and nothing from it is evidence for the PoC
execution, which is deployed afresh after assurance.

## Why

The flow cannot be exercised end to end otherwise, and keeping the instances apart preserves what
D17 protects: the execution the evidence pack describes is the one that passed review.

## Consequences

- Every capacity needs test-network gas, and the Deposit Agent needs the payment token from its faucet.
- The ceremony's wallet signers come from a mnemonic generated for the network, not the local node's.
- Contracts may be verified on the explorer, so their source is public (ADR 0027).
