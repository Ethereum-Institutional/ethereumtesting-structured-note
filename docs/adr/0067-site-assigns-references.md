# 0067. The site assigns client and custody references

- **Status:** Accepted (owner, 30 September 2026)
- **Date:** 30 September 2026

## Context

Staff typed a client reference when adding a client (ADR 0066). For each custodied admission they
also typed a custody account reference and a client instruction reference. None of these carry
information staff hold that the site does not, and each is a chance to mistype.

## Decision

- **Client reference:** assigned when a client is added, `CLI-<yymmdd>-<four characters>`,
  avoiding characters that are easily confused. A client re-issued from a corporate identity the
  bank already holds keeps the bank's reference.
- **Custody account reference:** `<client reference>-SEG-<nnnn>`, numbered per client, one
  account per admission. It remains the salt that fixes the account's address.
- **Instruction:** recorded as the admission itself, with the staff member who made it.

## Why

The site is the system of record for these (ADR 0066), so it can name them consistently and
without typing.

## Consequences

- Custodied onboarding is a single choice: the client.
