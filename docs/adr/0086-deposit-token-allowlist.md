# 0086. The tokenized deposit: an allowlist ERC-20 like JPMD, eligible by the bank's own identity registry

- **Status:** Accepted (owner, 14 October 2026)
- **Date:** 14 October 2026

## Context

0.2.0 replaces the demo's deposit token with a mock of a bank's tokenized deposit, on a public
test network (plan, decision 4).

**The only public, verified bank deposit token we found is JPMD on Base.** It is:
- an OpenZeppelin 5 upgradeable ERC-20 with 2 decimals, pausable and UUPS;
- governed by roles for issuer, burner, pauser, allowlist and upgrader;
- checked against an allowlist for sender, receiver and spender alike, so any DvP contract must itself be allowlisted.

Its issuer can force a transfer, and adding to the allowlist is timelocked.

**The other candidates differ.** The other public bank-issued tokens are MiCA e-money tokens with
blocklists, not allowlists. Most bank deposit tokens run on private ledgers.

OpenZeppelin 5 has no allowlist of its own. Community extensions (`ERC20Restricted`,
`ERC20Freezable`, ERC-7943's `ERC20uRWA`) exist but are unaudited.

Decision 2 of the plan gives each client one identity, with claims by role: the bank vouches for
the deposit, and the onboarding agent for the note.

## Options

1. **A plain allowlist,** exactly like JPMD. Simple, but a client's ERC-3643 identity would not
   carry over, so it would be onboarded twice.
2. **A full ERC-3643 token for the deposit too.** Uniform, but no real deposit token works this
   way, and it ties the cash leg to the security's compliance.
3. **JPMD's shape, with eligibility from the bank's own identity registry (chosen).**

## Decision

**The token itself:**
- an OpenZeppelin 5 ERC-20 with 2 decimals;
- roles: issuer (mint), burner, pauser, allowlist and enforcer;
- pausable;
- every transfer checks sender, receiver and spender.

**Who is eligible.** An account may hold and move the deposit when either:
- the bank's own ERC-3643 identity registry for the deposit verifies it, through the bank's KYB claim from the bank's claim issuer; or
- it is on the explicit allowlist, which is for contracts such as the Paying Agent and the locked settlement.

The deposit's identity registry shares identity storage with the note's, so a client's identity
is created once. Each asset keeps its own claim topics and trusted issuers.

**Freezing and forced transfer** follow ERC-7943's interface (`setFrozenTokens`,
`forcedTransfer`), held by the enforcer role. A community implementation, if used, is vendored and
pinned to a commit.

**Left out:** JPMD's timelock on allowlisting, its cap, and upgradeability. A mock needs none of
them, and the documents say so.

## Consequences

- One onboarding serves both assets, while the bank alone decides who may hold its cash.
- **The deposit is not ERC-3643.** It reads ERC-3643 identities through an interface, so it stays MPL-2.0 (ADR 0087).
- The unaudited community code is held to the interface, or kept small enough to test fully ourselves.
