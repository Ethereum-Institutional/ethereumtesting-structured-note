# 0069. One wallet per KYB, a new wallet replaces the old, and the Onboard page shows three stages

- **Status:** Accepted (owner, 30 September 2026)
- **Date:** 30 September 2026
- **Amends:** ADR 0062 (a client may onboard any number of wallets)

## Context

After onboarding, the Onboard page still offered "Ask my bank to confirm my KYB" and the
holder-wallet route, as if the client were new. The owner asked for a single **Bind a new wallet**
instead, for one wallet per KYB for now, and for the page to show the whole process.

## Decision

- **One wallet per KYB, on every route.** "KYB" is the client's corporate identity, by its
  subject: the corporation's DID. When a wallet is admitted, any other admitted wallet of the same
  client is offboarded, its two grants revoked, with the reason "replaced by \<new wallet\> (one
  wallet per KYB)". Re-admitting the same wallet replaces nothing.
- **Bind a new wallet.** A client onboarded before sees this in place of the routes.
  - **Route 2:** it opens a new binding under the confirmed KYB with no second review. The client's
    record is read afresh, so a re-screen counts.
  - **Route 3:** it starts the holder-wallet route again.

  The page says which wallet will be replaced.
- **Three stages** at the top of the page: 1. Complete bank onboarding, 2. Sign message from
  wallet, 3. Granted access, marked done, current or to come from the admission's status.

## Why

It is the simplest rule that keeps each client to one account in the pool, which the owner wants
for now. Replacing, rather than refusing, a second wallet lets a client move to a new wallet
without asking the bank.

## Consequences

- A second custody account for a client replaces the client's self-custody wallet, and the other
  way round. The Operator page says so.
- Lifting the limit later means dropping the replacement step. Nothing else depends on it.
