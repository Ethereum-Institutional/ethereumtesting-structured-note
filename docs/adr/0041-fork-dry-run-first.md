# 0041. Wave 5 is built locally and dry-run against a fork of the test network; the live deployment waits

- **Status:** Accepted (Wave 5)
- **Date:** 25 September 2026

## Context

D17 gates testnet execution on internal assurance review. Live testing of the pool needs test
credentials that only the vendor can issue.

## Options considered

| Option | Summary |
|---|---|
| Local, then a fork dry run | Build and test locally; add the network file and run the whole deployment and the venue tests against a fork of the test network, with the real payment token, pool manager, Permit2, wallet and protocol registries. |
| Deploy live in Wave 5 | Deploy to the test network now. |

## Decision

`ops/dry-run-fork.sh` forks the test network, deploys the whole stack against the real
contracts using the network file, and runs the venue tests against the result. The live
deployment is Wave 6.

## Why

It proves the wiring against every real dependency without publishing anything, and keeps the
assurance gate where D17 puts it.

## Consequences

- **Outside dependency, to start now:** the vendor must issue test credentials to our participants' wallets from the configured issuer, or register a test issuer for us.
- On the fork, grants are attested with credential identifiers that the real registries report as not revoked; no real credential is involved.
- **Found by the dry run, 25 September 2026.** The whole sequence, the ceremony on the canonical
  wallet included, deploys against the real contracts and the 23 venue tests pass. Four findings:
  - Forge routes a salted `new` through the deterministic deployer on the local node but not on a
    fork of the test network, so the hook landed at an address without its flags. The venue script
    now calls the deployer explicitly, which gives the same address everywhere.
  - On a fork of this OP-stack network, a pranked call from an address with no ether reverts before
    any code runs, whatever the gas price. The venue tests give a pranked caller ether first
    (`_as`), which changes nothing locally.
  - Forge caches forked state by chain id and block number, which successive dry runs share; the
    dry run turns the cache off.
  - **The local node's published development accounts carry EIP-7702 delegations on the test
    network**, set by whoever holds their public keys. They are usable on a fork, but a live
    deployment must never use them: every capacity needs its own key there (Wave 6).

