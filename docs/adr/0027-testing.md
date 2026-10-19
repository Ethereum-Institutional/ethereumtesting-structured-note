# 0027. Testing

- **Status:** Accepted
- **Date:** 16 October 2026

## Context

The failures that matter most happen at the seams: between pages, the site, the database and a
network whose nodes are not in step. Every one of those seams can be reproduced locally. A public
network is slow, costs real fees, and records everything for good. The full suite takes long
enough that running it for every change would slow every change.

## Decision

**Every test runs on the local chain.** Nothing is tested against a public network. The one contact
with a public network before a deployment is the fork rehearsal (record 0003), which runs on a local
fork and sends nothing.

**The suites:**

| Suite | Command | What it covers |
|---|---|---|
| Instruments | `forge test` in `instruments/` | The controller, the factory, the lifecycle, settlement, the payoff against the model's vectors, and the order of lifecycle events, step by step, each first tried out of turn |
| Venue | `forge test` at the root | The pool's gate, permissioned trading, custody accounts trading |
| Real wallets | `forge test` with the fork profile, against the local stack | Governance through the real Safe wallets: every act signed by two of three signers and executed by the wallet |
| Payoff model | `spikes/payoff` | The independent model and its vectors |
| Site units | `npm test` | Chain plumbing, quotes, calendars, term sheets |
| Site integration | `npm run test:admission` | Onboarding, notes, governance, jobs, the deposit and the deployment, against the local chain |
| Browser | `npm run test:browser` | Every portal and route clicked through, as clients and as each institution's staff |
| Everything | `npm run test:local` | A fresh chain, the units and integration, a fresh chain again, then the browser specs |

**The browser tests run as production does:** against a production build, with a fresh store, a
stand-in mailbox, and the chain reached through a proxy that, once it has returned a receipt,
answers reads from the block before, as a load-balanced public RPC whose nodes are out of step
does. The hazard is tied to receipts, not the clock, so it occurs on every run. They fail on any
page error or unhandled server error, and run one at a time, on one store and one chain.

**Which tests run when:**
- **A change, and the deploy that follows it, runs the tests that cover it:** the unit tests, the
  integration file for the library that changed, and the browser specs for the pages that changed.
- **The full suite runs at release tags,** or when the owner asks.
- **A page is done** only once a browser spec has clicked through it.

**Speed without shortcuts.** Local resets restore a snapshot of the deployed chain (record 0003).
Tests move the chain's clock rather than wait for a date, since every lifecycle time is the
chain's.

| Option | Chosen? | Why |
|---|---|---|
| Targeted tests per change; the full suite at release tags | Yes | Fast changes, and every interaction still caught before a release |
| The full suite before every deploy | No | About fifteen minutes on every change |
| Tests against the public test network | No | Slow, public and permanent, and its timing cannot be reproduced |

## Consequences

- A fix for a seam is proved by a test that fails without it.
- A public deployment carries only what the local suites have exercised.
- `docs/lifecycle-sequence.md` and `instruments/test/Sequence.t.sol` change together: if a contract
  changes the order of events, the test fails until the document is corrected.
