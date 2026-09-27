# 0056. Self-custody: the bank confirms the client's KYB first, then the client binds a wallet with one signature

- **Status:** Accepted (owner, 27 September 2026)
- **Date:** 27 September 2026

## Context

The self-custody route (ADR 0054) asked the client for a wallet address, had the bank review
the request, and only then asked for the wallet's signature. The bank reviewed an address no one
had proven, and the bank's signing challenge lives five to thirty minutes, so it cannot be signed
ahead of a review that may take hours.

## Options considered

| Option | Summary |
|---|---|
| KYB first, then bind | The client asks the bank to confirm its KYB by client reference; binding a wallet is disabled until the bank does; then the client names a wallet and signs the bank's challenge at once. One signature. |
| Prove the wallet at request, sign again after review | A site message signed at request, then the bank's challenge after review. Two signatures. |
| Sign the bank's challenge at request | One signature if the bank reviews within thirty minutes, otherwise sign again. |

## Decision

The self-custody route has two steps. First the client asks for its KYB to be confirmed, giving
only its client reference; the bank's staff confirm it against their file and state the client's
details. Until then, binding a wallet is shown but disabled. Then the client names a wallet, the
bank issues its challenge, the client signs it once, and the wallet credential and both grants
follow immediately.

## Why

The bank's review is of the client, not of the wallet. Once the client is confirmed, binding a
wallet needs no human, so it can happen in one signature while the challenge is fresh, and the
bank never reviews an unproven address.

## Consequences

- A confirmed KYB is held with the admission; a lapsed challenge is simply issued again.
- Supersedes the wallet-first ordering of the self-custody route in ADR 0054.
