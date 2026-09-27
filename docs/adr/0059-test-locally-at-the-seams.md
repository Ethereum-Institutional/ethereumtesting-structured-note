# 0059. Test the pages and the network's behaviour on the local chain, before every deploy

- **Status:** Accepted (owner, 27 September 2026)
- **Date:** 27 September 2026

## Context

Several production failures got past a green test suite:
- a form's decision that never reached the server ("Unknown decision");
- a page that refreshed itself away from wherever the client had navigated;
- the bank's typed data with integers as strings;
- the bank's verifier requiring the service key;
- a custody account refused by the deposit token right after its registry grant confirmed, because a load-balanced RPC answered from a node behind.

The tests called the service code directly, against a local node that is always consistent, and
against stand-ins that agreed with the site's assumptions. Nothing clicked a page. The owner does
not want tests run against public chains.

## Options considered

| Option | Summary |
|---|---|
| Browser tests and a lagging RPC, on the local chain | Chromium clicks through a production build against anvil, behind a proxy that reproduces an out-of-step public RPC. The stand-ins carry the real services' quirks. |
| A test admission on Base Sepolia before each deploy | Real network behaviour, but it sends transactions on a public chain every run. |
| Keep testing the services only | Fast, but it misses every failure listed above. |

## Decision

Every test runs on the local chain. The browser tests (`npm run test:browser`) click through
each route as the client and as the bank's staff, against a production build with a fresh store.
They fail on any page error or unhandled server error. The site reaches the chain through a proxy
that, just after returning a receipt, answers reads from the block before, as a node not yet in
step would. A custodied admission must finish within a time budget. The bank and verifier
stand-ins, shared by the Node and browser tests, reproduce each quirk found in the real services.
`npm run test:local` runs everything on a fresh chain, and passes before any deploy.

## Why

The failures were at the seams between the pages, the site, the services and the network, where
the tests had nothing. Each seam can be reproduced locally. The lagging proxy is tied to receipts
rather than to the clock, so the hazard occurs on every run. It was checked by removing the fix:
the test then fails with the production error, `ERC7943CannotSend`. The browser tests were
checked the same way: with "Unknown decision" restored, the self-custody test fails.

## Consequences

- Playwright and a Chromium build are development dependencies. A full run takes about two minutes.
- A newly found quirk of the real bank or verifier goes into `test/standins.ts` with a test, before the fix.
- Behaviour that only a public network shows, such as its fees or its actual congestion, stays untested.
