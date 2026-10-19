# 0003. Networks, deployment and verification

- **Status:** Accepted
- **Date:** 16 October 2026

## Context

The system runs in two places: a local chain for development and every test, and a public test
network for the bank to see. A deployment is dozens of contracts in a fixed order, and hands every
power to governance at the end. Nothing is upgradeable (record 0002), so a changed contract means
a fresh deployment.

## Decision

**Two networks:**

| Network | Chain | Used for |
|---|---|---|
| Local anvil | 31337 | Development and every test. The node's published keys; Permit2 and Safe 1.4.1 installed at their canonical addresses over RPC |
| Ethereum Sepolia | 11155111 | The public deployment the site points at. Canonical Uniswap v4, WETH, Permit2 and Safe contracts; Circle's EURC as the payment token |

- A public network's identifiers (RPC, pool manager, payment token, names and the term sheet
  base address) live in `ops/networks/<network>.json`, which is not committed; only the
  `.example.json` template is.
- Its keys live in `ops/keys.<network>.env`, also not committed. `ops/new-network-keys.sh` makes
  them. The local node's keys are `ops/keys.env`, committed because they are public.

**One deployment sequence, `ops/deploy-stack.sh`,** whose order cannot change:
1. a forced build of both units, so no script carries stale creation code;
2. on the local chain only, Permit2 and the Safe contracts;
3. the parties and the payment token;
4. the scaffolding: identities, T-REX, claim issuers, the deposit and its gateway, the lifecycle
   implementations (records 0005, 0006);
5. the conversion pool, unless `POOL=0` (record 0018);
6. custodians and their client accounts (record 0007);
7. the programme: the four institution wallets, the sanctions module, the governance controller
   and the note factory (records 0014, 0015);
8. the deployment's first note, issued from its term sheet through the factory (records 0009, 0019);
9. the ceremony: the pool's registries and the venue handed to the controller, and the deployer
   renouncing the deposit's and the gateway's administration. Last, so the deployer ends with
   nothing.

Addresses go into a manifest (`ops/addresses.json` locally, `ops/addresses.<network>.json`
otherwise), which the site and the tests read.

**A public deployment, `ops/deploy-network.sh`:**
- refuses any of the local node's published keys, and requires the network's own mnemonic for the
  institution wallets' signers;
- checks every sending key holds enough ETH for its share of the deployment at three times today's
  gas price, never less than 0.01 ETH, and that the bank holds the payment token to seed the pool.
  `CHECK_ONLY=1` stops there;
- runs forge with `--skip-simulation --slow`, so each transaction's gas is the chain's own estimate
  on the state the one before it left. Ethereum Sepolia prices state creation far above what forge
  simulates;
- verifies every contract on Etherscan at the end, when the key file holds an Etherscan key.

**A rehearsal first.** `ops/dry-run-fork.sh` runs the whole sequence against a local fork of the
public network, with its real contracts, and publishes nothing.

**Verification on Etherscan, `ops/verify-contracts.py`:**
- each contract a script created directly is verified from its own unit, with the constructor
  arguments read from its creation transaction;
- every contract created inside a transaction (by the identity, custody, T-REX and note factories)
  is found by tracing the transaction, matched to its artifact by creation code, and verified;
- a note's lifecycle contracts are minimal clones, recognised as such and reported as clones of
  verified implementations; T-REX's deployment stub, which has no source, is reported as a stub;
- a contract already verified is skipped, and no key is ever printed.

**Local resets are snapshots.** `ops/reset.sh` saves the chain as a deployment leaves it, keyed by
a hash of everything the deployment is made from, and restores it into a fresh node in seconds.
`FRESH=1` always deploys afresh; the five newest snapshots are kept.

## Consequences

- The deployment is the same code on both networks; only the network file and keys differ.
- A release whose contracts change is a fresh deployment on Ethereum Sepolia: notes, onboardings
  and the event index start again, while registrations, the bank's client records and the audit
  log carry over (record 0004).
- The ceremony leaves the deployer no power over the deposit, the gateway or the pool; the
  governance tests check the hand-over.
