# 0002. Code base, dependencies and licences

- **Status:** Accepted
- **Date:** 16 October 2026

## Context

The contracts build on two families of third-party code that cannot share a compiler: T-REX,
which pins Solidity 0.8.30 exactly, and Uniswap v4's permissioned-pool periphery, which pins
0.8.26 and needs the IR pipeline. Some of the third-party code is GPL-3.0. Every contract must also
fit the EIP-170 size limit.

## Decision

**Two compilation units:**

| Unit | Path | Compiler | What it holds |
|---|---|---|---|
| The instruments | `instruments/` | solc 0.8.30, Cancun, optimizer 200 runs, no IR | Identities, claims, the note's contracts, the deposit, the factory, the controller |
| The venue | repository root | solc 0.8.26, Cancun, IR | The conversion pool's checker, hook, router and gate, and custody accounts |

- The instruments reach the venue only through small interfaces, so the two never compile together.
- `ops/build.sh` builds both and fails if any deployable contract exceeds EIP-170. Size pressure is
  met by moving acts into libraries called by delegatecall (`VenueActs`, `CorrectionActs`).

**Dependencies, pinned:**
- T-REX 5.0.0-beta2 and ONCHAINID 2.2.2-beta3, with OpenZeppelin 5.6.1, through Soldeer
  (`instruments/soldeer.lock`). Used unmodified.
- Uniswap v4 core and periphery, as git submodules under `lib/`.
- Moving a pin is a deliberate change, made with a record of why.

**Licences:**

| Licence | Contracts | Why |
|---|---|---|
| GPL-3.0 | `RecordDateModule`, `ProgrammeSanctions`, `ExpiringClaimIssuer`, `ProgrammeTREXFactory`, `NoteFactory`, and the instruments' deploy scripts | They implement or extend T-REX or ONCHAINID code |
| MPL-2.0 | The governance controller and its act libraries, the Determination Agent, the Paying Agent, the locked settlement, the deposit and its gateway, the fixed implementation authority, the claim topics | Written as separate contracts that call T-REX through interfaces |
| MIT | The venue contracts and custody accounts | In the venue's own unit, apart from T-REX and ONCHAINID |

- No third-party compliance module is used: every module a note carries is our own.

**Nothing is upgradeable.** Every contract's logic is fixed at deployment. T-REX's proxies point
at a fixed implementation authority (record 0008); ONCHAINID's identity logic is fixed by
renouncing its authority's ownership; each note's lifecycle contracts are clones of fixed
implementations (record 0009).

## Consequences

- A change to deployed logic is a fresh deployment, not an upgrade (record 0003).
- The GPL boundary is narrow and stated in each file's SPDX header, for the bank's legal review.
- A contract that grows past EIP-170 fails the build, not the deployment.
