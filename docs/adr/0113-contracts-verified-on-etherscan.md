# 0113. Every contract verified on Etherscan

- **Status:** Accepted
- **Date:** 16 October 2026

## Context

The owner asked for every contract of the Ethereum Sepolia deployment to be verified on Sepolia
Etherscan, so anyone can read the source the chain runs. Two things make this more than one command:
- **Two compilation units.** The note's contracts build with solc 0.8.30, and the conversion pool's and custody's with 0.8.26 and the IR pipeline (ADR 0087). Each contract must be verified with its own unit's settings.
- **Contracts created inside transactions.** Forge's deploy records name only the contracts a script creates directly. The note factory creates each note's suite inside its issuance transaction: the token, identity, compliance, determinations, record dates, Paying Agent and settlement. The custody and identity factories create accounts and identities the same way, and notes issued from the site come later still. None of their constructor arguments appear in any transaction's input.

## Decision

**`ops/verify-contracts.py` verifies a deployment, in two passes, with `forge verify-contract`:**
1. **Directly created contracts.** Each contract in the deploy records is verified from its own compilation unit, its constructor arguments read from the creation transaction.
2. **Contracts created inside transactions.** Every deployment transaction, every note issuance and every transaction of the identity and custody factories is traced (`debug_traceTransaction`, call tracer). Each contract the trace shows created is matched to its build artifact by creation code, and verified with the constructor arguments that follow it.

**What it skips and how it reports:**
- A contract Etherscan already shows verified is skipped. Etherscan matches identical code by itself, so verifying one note's Paying Agent covers every note's.
- T-REX's factory deploys through a 21-byte stub that creates whatever code it is sent. It is raw bytecode with no source, and is reported as a stub.
- It never prints a key, and reports each contract as verified, a stub, or not verified, with the reason.

**After a deploy.** `deploy-network.sh` runs it at the end when the key file holds an
`ETHERSCAN_API_KEY`, so the bank's deployment is verified the same way. The IT hand-over guide says
how to run it again.

## Consequences

**Ethereum Sepolia, 16 October 2026:** 122 contracts.
- **102 verified,** among them:
  - the four notes' suites;
  - the note factory and its deployers;
  - the T-REX implementations and proxies;
  - the identities;
  - the deposit and its gateway;
  - the governance controller;
  - the custody accounts;
  - the conversion pool's contracts;
  - the multi-signature wallets.
- **20 deployment stubs** with no source.

**Notes issued later** are verified by running the script again: it finds each new issuance through
the factory's events, and Etherscan's matching usually covers them already.
