# 0079. Local resets restore a snapshot of the deployed chain

- **Status:** Accepted (owner, 1 October 2026)
- **Date:** 1 October 2026

## Context

`npm run test:local` reset the chain twice: before the integration tests, and before the browser
specs (each suite keeps its own store). Each reset deployed the whole stack again, one transaction a
one-second block: about three minutes, six in all. With the integration tests (about five and a
half minutes) and the browser specs (about five), a full run took about a quarter of an hour, and
it was run after every fix.

## Options

1. Snapshot the deployed chain and restore it, plus run only the affected tests while developing.
2. As 1, and run the two suites in parallel on two chains.
3. Run only the affected tests while developing, with no change to the setup.

## Decision

Option 1, chosen by the owner.
- **Snapshots.** `ops/reset.sh` saves the chain as the deployment leaves it (`anvil_dumpState`),
  with its manifest, in `ops/.chain-snapshots/` (not committed).
  - Later resets restore it into a new chain (`anvil_loadState`) in a few seconds. The blocks, logs and code are as deployed.
  - The snapshot is keyed by a hash of everything the deployment is made from: the contracts, the deployment scripts and settings, the dependencies' commits, and the anvil version. Changing any of them deploys afresh and saves a new snapshot.
  - `FRESH=1 ../ops/reset.sh` always deploys afresh. The five newest snapshots are kept.
- **Targeted runs.** While developing, only the tests a change touches are run. The full suite
  runs once before each deploy (ADR 0059).

## Consequences

- A full run drops by about six minutes, and a reset no longer discourages testing.
- If a restore fails, the reset deploys afresh rather than leaving a half-restored chain.
- A restored chain would resume from the snapshot's clock, behind the present. The site takes
  some times from the wall clock, such as a screening date, so a reset moves the chain's clock to
  the present after restoring. Nothing in the stack depends on the gap since the deployment: grants
  run for months, and the tests move the clock as they need.
