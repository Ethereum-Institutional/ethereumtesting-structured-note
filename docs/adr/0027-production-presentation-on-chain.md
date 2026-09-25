# 0027. What is written on-chain reads as production, and a public deployment sets it explicitly

- **Status:** Accepted
- **Date:** 25 September 2026

## Context

Everything a public network shows is read by people outside the transaction: token names and
symbols, anchored document references, and, once contracts are verified, their source and its
comments. Before this decision, the deposit was named "Tokenized deposit (simulated)", the note
"Structured Note (PoC)", the swap router `DemoPermissionedRouter`, and verified source described
the deposit as "valueless and simulated". The owner wants the deployment to read as production on
chain. The defaults of ADR 0008 applied to every chain, so an unset variable would have put a
placeholder on a public network.

## Options considered

| Option | Summary |
|---|---|
| Production wording, explicit values on public networks | Defaults and source read as production; on any chain other than the local node every name, symbol, term sheet URI and hash must be set, or the deployment stops. |
| Production wording, defaults everywhere | As above, but a public deployment may still fall back to a default. |
| Keep the labels | "Simulated" and "PoC" stay in names and source, as a disclosure on chain. |

## Decision

- The deposit is **Euro Tokenized Deposit**, symbol **`EURTD`**, decimals two.
- The note's default is **EUR Worst-of Autocallable Note**, symbol **`EURWAN`**, pending naming
  sign-off.
- The router is `PermissionedSwapRouter`. Deployed source describes what each contract does, not
  that it stands in for something.
- `DeployInstruments` reads `NOTE_NAME`, `NOTE_SYMBOL`, `DEPOSIT_NAME`, `DEPOSIT_SYMBOL`,
  `TERM_SHEET_URI` and `TERM_SHEET_HASH` with defaults on the local node (chain 31337) only. On
  any other chain, a fork of a public network included, each must be set or the script reverts.

## Why

Naming sign-off stays the gate for what reaches a public network, and it is enforced by the
script rather than remembered. Defaults everywhere would let a forgotten variable publish a
placeholder. Keeping the labels contradicts the owner's direction.

## Consequences

- **The disclosure moves off-chain; it does not disappear.** The overview and the evidence pack
  continue to state that the deposit is not a deposit of any institution and carries no value,
  and that network fees are paid in faucet units (HANDOFF section 7). A production-looking token
  called a deposit must never be described externally as a real one.
- The pool's wrapper token is named by the shipped periphery from the deposit: "Uniswap v4 Euro
  Tokenized Deposit", `v4EURTD`. Changing it would mean modifying audited upstream code; it stays.
- Values that cannot read as production are recorded as such: the credential protocol's test
  issuer identifier, which names its test network, and the euro payment token's testnet
  deployment.
- `TokenizedDeposit.sol` changed in comments only. It is in the rc1 surface (ADR 0026), so it is
  listed in the diff put to review; its runtime code is unchanged.
- Symbols should be checked against existing tickers as part of naming sign-off.
- Still to reword, in Wave 5's rewrite of the custody script: the custody account references
  (`CLIENT-A` to `CLIENT-D`) and the registry credential references derived from capacity names.
