# 0110. An account is named by the bank's client

- **Status:** Accepted
- **Date:** 16 October 2026

## Context

The owner could not find their client, "EU Corp", among the accounts to place units with. The only
account was listed as "Ethereum Institutional", a name that was no client of the bank's. It was in
fact EU Corp's account.
- **The cause.** The site named every account by the organisation its registrant typed at sign-up. That is the person's own words, not the bank's record. The bank had confirmed the account against its client EU Corp, and that name appeared nowhere.
- **The same flaw** ran through the pool page, the custodians' and the onboarding agent's lists, the deposit page's holders, the reconciliation statement and the Ledger's register.

## Decision

**An account is named by the bank's client it was confirmed against,** by its legal name, once the
bank has confirmed it. Until then, and on the existing-identity route, which has no client of the
bank's, it is named by the requester's organisation. One function (`accountNamer`) names accounts
for every page that lists them. A request still waiting for the bank keeps the requester's
organisation: no client has been chosen yet.

## Consequences

**Labels follow the bank's record.** A client removed and added again (ADR 0108) is named by its
new record.

**Eligibility is unchanged.** An account the onboarding agent has not vouched for is still marked
"(not eligible for the note)" in the placement list. The client asks for access to the note, and
the onboarding agent approves it.
