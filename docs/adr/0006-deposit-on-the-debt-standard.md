# 0006. The deposit shares the note's debt-standard base

- **Status:** Accepted (Wave 2, W4)
- **Date:** 24 September 2026

## Context

The tokenized deposit also carries ERC-7943 and needs the same six adaptations as the note
(spike 2). It could be built on the same base or separately.

## Options considered

| Option | Summary |
|---|---|
| Debt standard, shared base | Both tokens inherit one adapted composition. |
| Purpose-built minimal token | A small ERC-20 with ERC-7943 written directly. |
| An existing ERC-7943 reference | An open reference implementation. |

## Decision

Build the deposit on the debt standard, sharing `AdaptedToken` with the note.

## Why

Both legs of a settlement then answer eligibility with literally the same code and tests, which
removes a class of divergence. A deposit is itself a debt claim on the institution, so the standard
is a defensible fit. The reference implementations follow draft-era view names, the mismatch
already met in Wave 1.

## Consequences

- The deposit carries unused security-token features (terms, documents); a reviewer's question
  about it is answered here.
- 22,135 bytes, well within the limit.
