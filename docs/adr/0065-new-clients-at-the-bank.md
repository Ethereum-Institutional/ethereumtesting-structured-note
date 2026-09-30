# 0065. New corporate clients are added in the bank's own console, linked from the Operator page

- **Status:** Accepted (owner, 30 September 2026)
- **Date:** 30 September 2026

## Context

Staff choose a client from the corporate identities the bank has issued (ADR 0057). Adding a
client means the bank issuing one. The bank's issuance endpoint requires a staff session at the
bank, not a service key.

## Options considered

| Option | Summary |
|---|---|
| A. Link to the bank's console | Staff issue in the bank's own screens, and the client then appears in the Operator page's list. Nothing to build at the bank. |
| B. An issuing form on the Operator page | The site asks the bank to issue. It needs an issuing scope for service keys at the bank. |

## Decision

A. Beside the client list, the Operator page links to the bank's console. The link is set per
deployment as `bankConsoleUrl` in the network file, which becomes `BANK_CONSOLE_URL`.

## Why

It works today. Issuing a KYB credential is the bank's decision, taken in the bank's own tool.

## Consequences

- B remains possible once the bank offers an issuing scope.
