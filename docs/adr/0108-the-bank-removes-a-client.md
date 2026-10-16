# 0108. The bank removes a client, to add it again

- **Status:** Accepted
- **Date:** 16 October 2026

## Context

The owner asked for the bank to be able to remove a client, so that a record entered wrongly can be
put right by adding it again. A client's facts can be re-screened but not changed: the bank's claim
on each account carries a salted hash of the record (ADR 0089).

## Decision

**The bank removes a client from its records,** with a reason, from "Remove…" on Bank → Clients. The
audit log keeps the removal and its reason. The client is added again as new, with its own new
reference.

**Refused while any account for the client is onboarded on the chain.** That account's bank claim
carries this record's hash. The bank offboards the account first, or the client closes it
(ADR 0107).

**Onboardings in progress go back to the bank.** An onboarding confirmed against the client but not
yet on the chain (waiting for a wallet or a custodian, or failed) returns to waiting for the bank,
without its client. It is then confirmed against the client as added again.

## Consequences

**Tests:**
- **Integration:** removal is refused while the client's account is onboarded. A client whose onboarding is in progress is removed; the onboarding returns to the bank and is confirmed against the client added again.
- **Browser spec 18:** the bank is refused for a client on the chain, and removes a freshly added one.
