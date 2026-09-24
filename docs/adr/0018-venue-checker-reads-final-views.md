# 0018. The venue checker reads the Final ERC-7943 views and fails closed

- **Status:** Accepted (Wave 1, during the build)
- **Date:** 24 September 2026

## Context

The inherited venue checker read draft ERC-7943 views (`isUserAllowed`, `frozen`) that the
instruments do not expose, and relied on `try` blocks that do not catch a call to an address without
code.

## Options considered

| Option | Summary |
|---|---|
| Final views, checked static calls | Read `canSend`, `canReceive`, `getFrozenTokens`; every read fails closed. |
| Keep the draft views | Instruments would need to expose both. |
| Read the registry directly | Bypass the token's views at the venue. |

## Decision

Read the Final views through a checked static call; any failure denies. `paused()` is read where present.

## Why

The venue must be told what the token itself will enforce, through the interface D3 adopted. A
`try` block leaves a revert path through a malformed token. Reading the registry at the venue is the
Wave 5 design for the pool's own mask (section 7) and does not replace the token's views.

## Consequences

- Both instruments expose `paused()` for this reason.
- Wave 5 revisits the checker when the pool pairs with the deposit.
