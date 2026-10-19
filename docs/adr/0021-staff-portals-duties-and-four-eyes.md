# 0021. Staff portals, duties and four eyes

- **Status:** Accepted
- **Date:** 16 October 2026

## Context

Several institutions take part: the bank, its onboarding agent, the Agent, and custodians. Each
should see and act on its own records only. An agency and trust desk also separates duties within
the Agent: Calculation Agent staff determine, payments staff pay, and one person's mistake should
not reach the chain. A demonstration, though, is often run by one person.

## Decision

**Portals by role, behind one sign-in:**

| Portal | Path | List | What it holds |
|---|---|---|---|
| The bank | `/bank` | `BANK_EMAILS` | Sign-ups, clients' KYB records, onboarding, the deposit, the conversion pool |
| The onboarding agent | `/onboarding` | `ONBOARDING_EMAILS` | Requests for the notes, the note claim and its revocation, identities brought from elsewhere, participants |
| The Agent | `/agent` | `AGENT_EMAILS` | The book, participants as wallets and identities without client facts, notes and their lifecycle, reconciliation, governance, keys, the audit log |
| The custodians | `/custodian` | `CUSTODIAN_EMAILS` | The accounts each custodian opens, and the identities it manages |
| The client | `/onboard` | Any approved user | Its route, wallet, request for the notes, conversion and notes |

- Lists are explicit, with no default and no domain rule. `OPERATOR_EMAILS` grants every portal,
  so one person can demonstrate every role, and makes that person an admin.
- Every action checks the role on the server, not only in the page.

**Two duties at the Agent's desk:** Calculation Agent (`CALCULATION_EMAILS`) and payments
(`PAYMENTS_EMAILS`). Where a list is not set, everyone at the Agent's desk holds that duty.
Operators hold both.

**Four eyes on determinations and payments:**
- Someone with the duty proposes. A determination is proposed with its Levels and their source,
  and checked at once against the contract's computation.
- A second person holding the same duty, not the proposer, approves it; only then is anything sent.
- Either person with the duty may decline it, with a reason, and nothing is sent.
- Approval and sending run as a background job (record 0022).

**An automatic second approver, by deployment setting.** `FOUR_EYES=auto`, the default, has the
deployment's automatic second approver approve every proposal at once, for the demonstration.
`FOUR_EYES=strict` requires a person. Every approval is recorded with who gave it; an automatic one
says so on the page and in the audit log.

| Option | Chosen? | Why |
|---|---|---|
| Same duty, another person, with an optional automatic approver | Yes | Separates duties as a desk does, and lets one person run a demonstration |
| Separate maker and checker roles | No | Four identities to run one lifecycle |
| Any second person at the desk | No | No separation by duty |
| Four eyes on issuance and governance too | No | Those already need two signers of their institutions' wallets |

## Consequences

- A deployment for a real desk sets `FOUR_EYES=strict` and the two duty lists.
- Four eyes decides whether the Calculation Agent's key signs, not who holds it.
- Every staff act is in the audit log with who did it.
