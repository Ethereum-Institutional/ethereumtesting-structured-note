# 0040. The local stack installs the protocol's released registry code at its canonical addresses

- **Status:** Accepted (Wave 5)
- **Date:** 25 September 2026

## Context

The protocol's registries pin a compiler older than the venue unit's, as Permit2 and the wallet
do. Its implementations are upgradeable and embed their own address, so they only work at the
address they were deployed to.

## Options considered

| Option | Summary |
|---|---|
| Install released code | Fetch each implementation's runtime code from the test network, record its hash, install it at its canonical address on the local node, and put fresh proxies in front of it. |
| Submodule, third compiler | Build the protocol from source in its own unit. |
| Stand-in only | A minimal fixture everywhere. |
| Fork the test network | Run the local stack against a fork. |

## Decision

`ops/setup-credential-protocol.sh` installs the two registries' live implementations at their
canonical addresses, refusing any file whose hash has changed. The first deploy step puts proxies
in front of them, initialises them and registers a local issuer with the published key at index 22
of the local mnemonic. Unit tests of the gate use a small stand-in.

## Why

The gate is exercised against the code it will meet, without a third compiler pin, as ADR 0024
does for the wallet. The stand-in keeps unit tests fast and able to simulate failures.

## Consequences

- The vendor's deployment record lists older implementations; the live ones, read from each proxy's implementation slot on 25 September 2026, are the ones installed.
- The local issuer registers placeholder public keys of the lengths the registry requires; no credential signature is checked on-chain in any case.
- The local node funds 23 accounts.
