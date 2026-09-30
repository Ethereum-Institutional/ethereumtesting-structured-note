# 0062. A client can always onboard another wallet; the bank's custodied admissions never block it

- **Status:** Accepted (owner, 30 September 2026)
- **Date:** 30 September 2026

## Context

The onboarding page showed the signed-in account's newest admission of any route. A custodied
admission is recorded under the staff member who performs it. So once staff onboarded a client by
custody, their own onboarding page showed that admission instead of the routes, and while it waited
for anchoring (ADR 0060) both other routes were blocked. More generally, the owner wants a client
the bank has onboarded by custody to be able to add a wallet it holds itself (route 2), or to
present from Maknoon (route 3).

## Options considered

| Option | Summary |
|---|---|
| The client's page follows the client's own routes | It considers only self-custody and holder-wallet admissions. Once one is finished, both routes are offered again, so a client can onboard any number of wallets. It lists those already onboarded. |
| Link custodied admissions to the client's account | Show them on the client's page too. That needs a link between the bank's client reference and a site account, which does not exist. |

## Decision

The first option. `/onboard`, which replaces `/admit` (redirected), shows the client's own newest
admission on routes 2 and 3 only. Any number of wallets can be onboarded, one admission open at a
time. The page lists the wallets the client has onboarded. Custodied admissions remain the bank's
own acts, shown to staff on `/operator`.

## Why

Custody is the bank acting for the client, not the client acting. It should not stand in the way
of the client adding its own wallet. Onboarding several wallets is normal for an institution.

## Consequences

- A client's custody accounts are not listed on its own page. A link from the bank's client
  reference to a site account would allow that later.
- Navigation reads Onboard and Operator.
