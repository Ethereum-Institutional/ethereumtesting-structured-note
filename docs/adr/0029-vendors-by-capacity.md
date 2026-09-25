# 0029. Vendors are named by capacity; their identifiers live in a network file

- **Status:** Accepted (Wave 5)
- **Date:** 25 September 2026

## Context

D16 keeps client and vendor names out of the tree and out of deployed metadata. The pool now uses
a third-party euro payment token and the credential protocol, both identified by addresses, and the
protocol identifies issuers by a string identifier (a DID) that carries its own name, as do its
schema URIs.

## Options considered

| Option | Summary |
|---|---|
| Capacity names, network file | Code and documents say "euro payment token" and "credential protocol". Addresses, the issuer DID and schema URIs for a public network live in an untracked network file with a committed template. |
| Name them in code | Interfaces and variables named after the vendors. |

## Decision

Capacity names throughout. `ops/networks/<network>.json` holds each public network's identifiers
and is not committed; `ops/networks/base-sepolia.example.json` shows its shape. The local stack uses
neutral identifiers (`did:example:credential-issuer` and `schema:*` URIs).

**Refined during the build:** the gate stores the configured issuer DID in its own storage,
set at construction, rather than taking it in each grant's calldata and checking it against a hash.
The protocol's registries are keyed by the string, so it is on-chain either way; storing it once
removes a per-grant argument and a check.

## Why

It keeps D16 without hiding anything that matters: every identifier is still recorded, in the
deployment record and the network file, and the ADR says which vendor-specific values reach the
chain. Naming vendors in code would put their names in verified source.

## Consequences

- The issuer DID is visible on a public network, in the gate's storage and in the protocol's own registries. It names its test network (ADR 0027).
- A public deployment cannot run without its network file.
