# 0024. Keys, signing and fees

- **Status:** Accepted
- **Date:** 16 October 2026

## Context

For one person to run the whole lifecycle on a public test network, the site must sign for each
capacity: the bank, the onboarding agent, the custodians, the Issuer, the Agent, the Calculation
Agent, and the owners of the institutions' wallets. Several servers may run at once, a node may lag
behind, and a key without ETH stops the desk.

## Decision

**Keys by capacity.**
- `SIGNER_KEYS`, a JSON object of capacity to private key, set as a sensitive production variable.
  On the local chain alone the node's published keys are the default; on any other chain a missing
  key is an error, never a fallback.
- The site holds two owners' keys of each institution's 2-of-3 wallet and of the servicing wallet.
  A wallet's transaction is signed by those two owners and sent by an ordinary key, so the wallet
  acts exactly as it would on its owners' signatures from their own devices. The owners only sign
  and need no ETH.
- Clients sign their own side in their own browser wallet; custodians sign for their custody
  accounts.

**One sender per key.**
- Each key's transactions go out one at a time, each waiting for its receipt, in a queue per key.
- Across servers, the key is held under a lease in the database while a transaction is sent and
  confirmed. The lease carries the key's next nonce, so a node that lags behind cannot hand out one
  already used.
- A receipt is awaited for up to 150 seconds on a public network and 25 seconds locally. On the
  local chain only, a receipt that never comes is treated as a nonce gap: the pool is cleared and
  the transaction sent once more.
- Just after a transaction, reads that depend on it wait (about ten seconds at most) for a node that
  has not yet seen its block.

**Fees.**
- Before signing, the site refuses a transaction its key cannot pay twice the estimated fees for,
  naming the key's role, address, balance and what is needed. A network's own refusal for want of
  fees is reported in the same words.
- A key below `FEE_BUFFER_ETH` (0.001 ETH by default) is low: its transactions still go, but the
  Agent's portal warns and counts it.
- Agent → Keys lists every key with its role, address, ETH and transactions left at today's fees.
  A low key is topped up with `TOP_UP_ETH` (0.003 ETH by default) from the best-funded key, which
  must keep its own buffer; each top-up is in the audit log.
- Before a client's browser wallet is asked to send, the page checks it can pay twice the estimated
  fees.

## Consequences

- One person can demonstrate every institution on the public network.
- Every key the site holds is a secret of the deployment's hosting, never committed.
- Two servers never race one key into a nonce collision.
