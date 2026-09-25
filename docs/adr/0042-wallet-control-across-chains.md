# 0042. Wallet control is accepted from any EVM chain for ordinary wallets, and from the pool's chain for contract wallets

- **Status:** Accepted (owner, 25 September 2026)
- **Date:** 25 September 2026

## Context

The credential protocol now issues a wallet-control credential that binds a wallet to a holder
(a corporate identity or a natural person) after the wallet signs a challenge: an ordinary wallet
(EOA) by EIP-712, a contract wallet by EIP-1271 (ADR 0036). The credential records the chain the
signature was made against as a CAIP-2 identifier. The pool runs on one chain; a holder may have
proved control on another.

## Options considered

| Option | Summary |
|---|---|
| Any EVM chain for ordinary wallets; the pool's chain for contract wallets | An EOA's address is derived from its key alone, so control proven on one EVM chain is control on all. A contract wallet's code and owners are per chain. |
| Any EVM chain for every wallet | Simplest; treats a contract wallet like a key. |
| The pool's chain only, for every wallet | Strictest; forces a holder to re-attest per chain for no gain in the EOA case. |

## Decision

The Access Issuer accepts a wallet-control credential for an **ordinary wallet** whatever EVM
chain it names (`eip155:*`), and checks only that the signer recovers to the wallet address. For a
**contract wallet** it accepts the credential only if the chain it names is the pool's own chain,
because an EIP-1271 answer is a property of the code at that address on that chain.

## Why

The owner's position, and correct for keys: the same private key controls the same address on
every EVM chain, so demanding a chain match adds friction without adding assurance. Contract
wallets differ: the same address can hold different code, different owners, or nothing yet on
another chain (a counterfactual address can be claimed by whoever deploys there first), so a
signature checked on one chain proves nothing on another.

## Consequences

- The check is the attester's, off-chain; the gate records no chain.
- An EOA with an EIP-7702 delegation is still controlled by its key and is treated as an ordinary
  wallet; the delegation is not a reason to refuse it.
- Contract wallets are handled chain by chain, confirmed by the owner: a custody account
  (ADR 0036) is admitted to a pool only with a credential naming that pool's chain, and a pool on
  another chain needs its own credential.
- The Access Issuer must verify presentations against issuer keys pinned in the verifier's trust
  configuration, not read from the protocol's registry: a registrar can rotate an issuer's
  registry key (ADR 0028).
