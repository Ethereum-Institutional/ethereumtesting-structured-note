# 0087. A narrow GPL-3.0 boundary around T-REX, and no non-commercial modules

- **Status:** Accepted (owner, 14 October 2026). Subject to the bank's legal review.
- **Date:** 14 October 2026

## Context

Our code is MPL-2.0. T-REX and ONCHAINID are GPL-3.0, although ONCHAINID's package metadata says
ISC. A contract that inherits GPL code is a derivative work.

Tokeny's eleven stock compliance modules are CC-BY-NC-4.0: non-commercial only.

## Decision

- **Unmodified.** T-REX and ONCHAINID are used unmodified, as pinned dependencies.
- **GPL-3.0, with their own SPDX headers.** Only the contracts that must inherit T-REX or ONCHAINID code:
  - the record-date compliance module, on `AbstractModuleUpgradeable`;
  - our claim issuer with expiry.
- **MPL-2.0.** The Paying Agent, locked settlement, governance controller, deposit token and factory, written as separate contracts that call T-REX through interfaces.
- **No Tokeny compliance modules.** Any module the note needs is our own.
- **Stated plainly.** The documents carry a licence note: what is GPL, what is MPL, and why. It is marked for the bank's legal review.

## Consequences

- The copyleft boundary is small, and visible file by file.
- Whether calling through an interface keeps a contract outside the GPL is a legal question. The note says so, rather than asserting it.
