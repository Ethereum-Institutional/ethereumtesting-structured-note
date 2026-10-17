# 0118. Four eyes by duty, with an optional automatic approver

- **Status:** Accepted, for release 0.3.0 (workstream 12)
- **Date:** 16 October 2026

## Context

The owner chose four eyes on determinations and payments (ADR 0115): one person's mistake should
not reach the chain. An agency and trust desk separates duties: Calculation Agent staff determine,
payments staff pay. A demonstration, though, is often run by one person.

## Decision

- **Two duties at the Agent's desk:** Calculation Agent (`CALCULATION_EMAILS`) and payments
  (`PAYMENTS_EMAILS`). Where a list is not set, everyone at the Agent's desk holds that duty.
  Operators hold both.
- **Proposed, then approved, then sent.** A determination (with its Levels and their source) or a
  payment is proposed by someone with the duty and checked at once. It waits until a second person
  holding the same duty, not the proposer, approves it; only then is anything sent. Either person
  with the duty can decline it, with a reason, and nothing is sent.
- **An automatic second approver, by deployment setting.** `FOUR_EYES=auto`, the default, has the
  deployment's automatic second approver approve every proposal at once, for the demonstration.
  `FOUR_EYES=strict` requires a person. Every approval is recorded with who gave it, and an
  automatic one says so on the page and in the audit log.
- Approval and sending use the background jobs of ADR 0116: an approved proposal is a job that runs
  to its end with no page open.

| Option | Chosen? | Why |
|---|---|---|
| Same duty, another person, with an optional automatic approver | Yes | Separates duties as a desk does, and lets one person run the demonstration |
| Separate maker and checker roles | No | Four identities to run one lifecycle |
| Any second person at the desk | No | No separation by duty |

## Consequences

- The demonstration portal runs with the automatic second approver, and says so wherever it
  approved. A deployment for a real desk sets `FOUR_EYES=strict` and the two lists.
- The Calculation Agent's key still signs; four eyes decides whether it signs, not who holds it.
