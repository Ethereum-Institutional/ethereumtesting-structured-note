# 0083. Records scoped to a deployment, for a fresh deployment of the test network

- **Status:** Accepted (owner, 1 October 2026)
- **Date:** 1 October 2026

## Context

The owner asked for a fresh deployment of the stack on Base Sepolia, so that the execution
window for Tier 2 proposals (ADR 0082) and locked settlement (ADR 0081) are live on every note.
The live controller has no act to hand its roles to a successor, so the whole stack is
deployed afresh, at new addresses.

The site's records live in a Postgres database whose address is a protected setting. Admissions
and notes act on a deployment's contracts, and after a fresh deployment they would point at
contracts no longer in use.

## Options

1. Scope records to a deployment.
2. Empty the tables bound to the chain, with a reset action added for this one use.
3. A new, empty database.

## Decision

Option 1, chosen by the owner.
- **The deployment key.** A deployment is identified by its chain and its Identity Registry's address, which every deployment has its own of.
- **Stamping and reading.** The store stamps each admission and note with the current deployment when it writes one, and reads only the current deployment's. This applies to every read: by id, by request, by registrant, the latest, and the lists.
- **Earlier rows.** A row with no stamp, or another deployment's, is kept as history and never read.
- **What carries over.** Registrants and their sessions, the bank's clients (their KYB, and the corporate identities issued at the bank) and the audit log are the bank's, not a deployment's.
- **No manifest.** Where no manifest is configured, nothing is scoped.

## Consequences

- After the fresh deployment, clients' wallets are onboarded again: their grants are on the earlier deployment's registry. Staff need not add clients again.
- Notes are numbered afresh: the new deployment's first note issued from the site is Series 2 again.
- The earlier deployment's manifest is kept as `ops/addresses.base-sepolia.2026-09-25.json`, not committed.
- A later deployment of the same network needs no migration: its rows are simply its own.
