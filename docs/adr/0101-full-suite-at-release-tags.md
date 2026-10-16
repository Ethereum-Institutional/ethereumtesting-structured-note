# 0101. The full local suite runs at release tags; a change runs the tests that cover it

- **Status:** Accepted
- **Date:** 16 October 2026

## Context

Tests run only on the local chain (ADR 0059). Until now, the whole local suite (`npm run test:local`)
ran before every deploy of the site:
- the unit tests;
- 32 integration tests through a lagging RPC;
- 16 browser specs, with a chain reset and a production build between them.

It takes about 15 minutes, more when the local chain must be redeployed. The owner found that too
long to pay on every change.

## Decision

**The full suite runs only:**
- before a release is tagged;
- when the owner asks for it.

**Every other change, and the deploy that follows it, runs the tests that cover what changed.**
That means the unit tests, plus:
- the integration file for the library that changed;
- the browser specs for the pages that changed.

A page change still counts as done only once a browser spec has clicked through it (ADR 0059).

| Option | Outcome |
|---|---|
| The full suite at release tags; targeted tests for each change | **Chosen by the owner** |
| The full suite before every deploy | The previous rule. It catches interactions between specs, at about 15 minutes each time |

## Consequences

**A gap between tags.** A regression in a part no targeted test covers can reach the site, and is
caught at the next release tag instead. The specs share one local chain in order, so an interaction
between them is likewise found only by the full run.

**Picking the tests.** The tests to run for a change are chosen by what it touches, and named in
the commit or the conversation, so the choice can be checked.

**First use.** The sign-in link (ADR 0099), the deletion of a registration and the wallet message
(ADR 0100) were tested this way:
- the onboarding integration test (8 passed);
- browser specs 00, 01 and 03 (passed, in 42 seconds).
