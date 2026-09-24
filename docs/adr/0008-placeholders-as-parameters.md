# 0008. Names, symbols and the term sheet are deploy parameters

- **Status:** Accepted (Wave 2, W6)
- **Date:** 24 September 2026

## Context

Token names wait on naming sign-off and the term sheet is not final, but the contract surface is
frozen in Wave 4.

## Options considered

| Option | Summary |
|---|---|
| Parameterise, keep placeholders | Environment variables with placeholder defaults. |
| Hard-coded placeholders | Change the values in a commit at sign-off. |
| Anchor a draft term sheet now | Hash a current draft and re-anchor later. |

## Decision

`NOTE_NAME`, `NOTE_SYMBOL`, `DEPOSIT_NAME`, `DEPOSIT_SYMBOL`, `TERM_SHEET_HASH` and `TERM_SHEET_URI` override the defaults in the deploy script.

## Why

Sign-off then changes configuration, not code, and never touches the frozen surface. An anchored
draft could be mistaken for the governing document, and no draft exists in the repository.

## Consequences

- The deployment record shows which values were used.
