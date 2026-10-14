# 0085. T-REX 5.0.0-beta2 with ONCHAINID 2.2, and agents limited to what each needs

- **Status:** Accepted (owner, 14 October 2026)
- **Date:** 14 October 2026

## Context

0.2.0 makes the structured note an ERC-3643 token through T-REX (plan, decision 1). The
reference code has moved twice:
- Tokeny's repository is archived, at 4.1.6.
- The ERC-3643 Association's stable line is 4.1.3, built with Hardhat and solc 0.8.17. A 4.2.0 beta adds agent restrictions.
- In 2026, new work moved to the T-REX Network. Its 5.0.0-beta2 is built with Foundry and Soldeer, solc 0.8.30 and OpenZeppelin 5.6.1. Its develop branch, rebuilt on AccessManager, is unreleased.

ONCHAINID 2.2.x is public. Version 3 needs a private repository.

T-REX's agent role carries every power: mint, burn, forced transfer, freezing, recovery and pause.
The Paying Agent and the locked settlement contract each need only one or two of them.

## Options

1. **ERC-3643 4.1.3, stable.** Audited (Hacken, 2023) and widely deployed. It has no agent
   restrictions, so we would write and test our own wrapper to limit each agent's powers. It also
   needs a second toolchain beside Foundry.
2. **T-REX Network 5.0.0-beta2, pinned (chosen).** Foundry-native, on a current compiler and
   OpenZeppelin. It has `setAgentRestrictions`: the owner switches off individual powers for each
   agent. It is a pre-release.
3. **The v5 develop branch, or ONCHAINID 3.** Unreleased, or private. Rejected.

## Decision

- **Dependencies.** T-REX Network 5.0.0-beta2, pinned to an exact version through Soldeer, with the ONCHAINID 2.2 release it depends on. The code is used unmodified.
- **Each lifecycle contract is a T-REX agent, with only its own powers enabled:**

| Agent | Powers enabled |
|---|---|
| Paying Agent | burn (redemption), pause (termination) |
| Locked settlement | partial freeze and unfreeze |
| Governance controller | forced transfer, wallet recovery (S-25), address freeze, pause |
| Issuer | mint (placement into inventory) |

- **Ownership.** The governance controller owns the token, so restrictions change only through governance.

## Consequences

- No agent wrapper of our own to audit. Restrictions are tested for each agent: every power not enabled must be refused.
- **A pre-release dependency.** Recorded as a risk. The pin is moved only deliberately, with the test suite rerun.
- The T-REX Network's audit of 5.x is in progress; the documents say so.
- T-REX allows at most five agents per token, and the design uses four.
