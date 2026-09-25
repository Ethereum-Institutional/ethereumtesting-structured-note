# 0046. For an entity, an authorised officer presents

- **Status:** Accepted (owner, 25 September 2026)
- **Date:** 25 September 2026

## Context

Under the protocol's corporate design a corporation does not run the holder wallet: its
corporate identity sits in its own issuer backend, served by discovery, and people act for it
through an officer-role credential that the verifier cross-checks against the corporate
identity's officer roster.

## Options considered

| Option | Summary |
|---|---|
| An authorised officer presents | The officer's wallet presents the officer-role credential and the wallet-control credential; the verifier fetches and checks the corporate identity by discovery. |
| The corporation holds its own credentials in a wallet | Simpler, but departs from the protocol's design and names no signatory. |

## Decision

An entity is admitted when one of its officers presents, from their own wallet. The corporate
identity is fetched from the corporation's issuer backend and must match the officer credential's
corporation and roster; the verifier checks that composition.

## Why

It is the protocol's own model, and it answers the open question in the handoff of who at the
corporation authorised the wallet: a named officer, on the record, whose authority can be revoked.

## Consequences

- The corporation's issuer backend must have its corporate identity ingested; today neither demo corporation has.
- The officer needs an officer-role credential.
- How the officer credential and the wallet binding are recorded on-chain is decided separately.
