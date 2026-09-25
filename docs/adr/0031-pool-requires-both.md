# 0031. The pool requires both the deposit's eligibility and a live credential grant

- **Status:** Accepted (Wave 5)
- **Date:** 25 September 2026

## Context

The venue checker already answers from the deposit's ERC-7943 views, which read the Identity
Registry. The credential gate is a second perimeter, specific to the pool.

## Options considered

| Option | Summary |
|---|---|
| Both | A swap or liquidity action needs the deposit's own `canSend` and `canReceive`, no pause, no whole-balance freeze, and a live credential grant. |
| Credential only | The checker reads only the credential gate. |

## Decision

The checker keeps every existing read and adds the credential gate, configured per token and
read through a checked static call that fails closed. `explain` reports it separately.

## Why

The deposit refuses a wallet the registry does not know, so a credential-only pool would admit a
wallet and then fail inside the settlement with a worse error. Keeping the registry path also keeps
supervisory withdrawal (ADR 0004) stopping the venue at once, which the overview promises.

## Consequences

- A participant needs a registry grant and a credential grant. The first is the whitelist of record; the second is the pool's own mask (overview, "the conversion pool tests a different mask").
- Pointing the checker at a new gate is a Tier 2 act (ADR 0039).
