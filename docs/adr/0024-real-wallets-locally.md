# 0024. The local stack runs the real multi-signature wallet

- **Status:** Accepted (Wave 4)
- **Date:** 25 September 2026

## Context

ADR 0016 has each institution run an established, audited open-source wallet. Its release is
built on an older compiler than either of our compilation units, as Permit2 is.

## Options considered

| Option | Summary |
|---|---|
| Real wallet locally, stand-in in unit tests | Install the released bytecode at its canonical addresses over RPC; unit tests use a small stand-in. |
| Stand-in only | A minimal wallet in the fixtures everywhere. |
| Vendor as a submodule | Build the wallet's source in a third compilation unit. |

## Decision

The local stack installs the wallet's released runtime code at its canonical addresses over RPC,
as it does for Permit2, and each institution gets a real wallet with real thresholds. An integration
test drives Tier 2 through them. Controller unit tests use a stand-in exposing the same threshold
view. On the test network the canonical deployment is used as it is.

## Why

The governance path is exercised against the code it will run on, without a third compiler pin.
The stand-in keeps unit tests fast and able to simulate failure modes.

## Consequences

- The installed code's provenance is its canonical address and a recorded hash, checked on install.
- The integration test runs against the local node, like the venue tests.
