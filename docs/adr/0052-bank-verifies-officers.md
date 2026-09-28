# 0052. The bank verifies the officer structure and issues officer credentials; changes wait for notice or the periodic refresh

- **Status:** Accepted (owner, 25 September 2026)
- **Date:** 25 September 2026

## Context

ADR 0049 records the presenting officer's credential in the grant and checks its revocation
under the pool's one configured issuer. In the credential protocol's own corporate design the
corporation issues its officers' credentials, which would put their revocation under the
corporation's identifier, where the gate does not look.

## Options considered

| Option | Summary |
|---|---|
| The bank verifies and issues | The configured issuer (the bank) verifies the corporation's officer structure and issues the officer credentials; the corporation notifies the bank of changes that affect its signers; otherwise changes wait for the periodic refresh. |
| The corporation issues, the gate follows | The gate records the officer credential's own issuer and checks revocation there. |

## Decision

The bank issues officer credentials after verifying the corporation's officer structure, so
all four credentials in a grant come from the one configured issuer and the gate needs no
change. A corporation notifies the bank when an officer change affects its signers, and the bank
revokes the officer credential; the grant can then be voided by anyone. Short of notice, a change
takes effect at the periodic refresh: the officer credential expires and is re-issued.

## Why

The owner's position: the bank already carries the KYB relationship and is the party relying on
who may sign, so verifying officers is part of its role, and this keeps the PoC to one issuer. A
per-credential issuer in the gate solves a wider problem than this pool has.

## Consequences

- The Access Issuer requires every presented credential to be issued by the configured issuer.
- A grant expires no later than the earliest expiry among the credentials it rests on, so the
  officer credential's validity is the refresh period in practice. The refresh period is the
  bank's to set.
- Between an officer change and the bank's revocation, the former officer's grant stands; that is
  the notice obligation's to close, and the evidence pack states it.
- Departs from the protocol's own corporate model (ADR-0027 there), where corporations issue
  their officers' credentials; recorded here so it is not mistaken for that model.
