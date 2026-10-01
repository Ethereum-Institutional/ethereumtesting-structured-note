# 0074. The self-custody route is shown as Third party

- **Status:** Accepted (owner, 1 October 2026)
- **Date:** 1 October 2026

## Context

Route 2 (ADR 0054) binds a wallet the client controls and signs for. The bank knows the client
controls it, but not whether the client holds it itself or another custodian holds it for it.
"Self-custody" claims more than the bank knows.

## Decision

Everywhere a user sees it, the route is **Third party**:
- the Operator navigation and its page, `/operator/custody/third-party` (the old address redirects);
- the Admissions table, the Onboard page and the Ledger's reconciliation;
- the audit log's wording.

The stored route value stays `self-custody`, so existing admissions and their records are
unchanged; one label map (`lib/routes.ts`) names every route for display.

## Consequences

- ADRs before this one call the route self-custody; they mean this one.
