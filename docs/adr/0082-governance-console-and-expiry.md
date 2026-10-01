# 0082. Governance from the site, and an execution window for Tier 2 proposals

- **Status:** Accepted (owner, 1 October 2026)
- **Date:** 1 October 2026

## Context

The governance controller (ADRs 0016, 0021 to 0025) governs the deployment's own note, the deposit, the registry, the Paying Agent and the venue, in two tiers:
- **Tier 1:** the Agent's governance wallet alone, with a written reason.
- **Tier 2:** typed proposals approved by at least two of the three institutions' 2-of-3 wallets, with four signatures between them, executable after a delay.

Its Foundry tests cover S-22 (one institution cannot queue), S-25 (a Tier 1 register correction) and S-26 (only the controller can force a transfer). But S-24, "a Tier 2 proposal left unexecuted past its window expires", was not implemented: a queued proposal stayed executable for ever. Nothing of governance could be done from the site.

## Options

1. **S-24:**
   - (a) an execution window in a new controller, enforced on-chain;
   - (b) enforced by the site only;
   - (c) left open.
2. **Signing:**
   - (a) site-held test keys, two owners of each institution's wallet;
   - (b) each signer in MetaMask.
3. **Acts offered:**
   - (a) those that cannot break the deployment, the rest listed but locked;
   - (b) all of them;
   - (c) Tier 1 and one Tier 2 act.
4. **Place:**
   - (a) Operator → Governance;
   - (b) the note's page.

## Decision

1(a), 2(a), 3(a), 4(a), chosen by the owner.
- **The execution window.** The controller takes `executionWindow` at construction and refuses zero.
  - A queued proposal not executed within `EXECUTION_WINDOW` of becoming ready has expired: `execute`, `approve` and `cancel` revert with `Expired(id, expiredAt)`. Acting again means proposing afresh, with fresh approvals and a fresh delay.
  - `expired(id)` reads it. The window is one day on the PoC, beside the one-hour delay; the target is seven days.
  - The ceremony records both in the manifest. Foundry tests: `test_queuedProposalExpiresPastItsWindow`, `test_executionWindowMustBeSet`.
- **Signing.** The site holds the first two owners' keys of each institution's governance wallet: the Agent's (mnemonic indices 10, 11), the Issuer's (13, 14) and the co-signing institution's (16, 17).
  - Each act is that wallet's own transaction, signed by its two owners and sent by the Agent's key.
  - It is first simulated from the wallet, so a refusal is the controller's own reason, not the wallet's.
  - The owners only sign. The Keys page shows them as needing no ETH.
- **Operator → Governance → Tier 1:**
  - **Correct the register:** a forced transfer with its written reason (S-25).
  - **Withdraw a grant or pool access.**
  - **"Attempt a forced transfer as the Agent":** simulates the servicing wallet calling the note directly, sends nothing, and shows the refusal and who does hold the right (S-26).
  - **The Tier 1 record:** read from the controller's events.
- **Operator → Governance → Tier 2:**
  - **The controller's settings:** its thresholds, delay and window.
  - **A proposal form:** amending the notional in the Issuer's inventory, the longest grant validity, and the pool's liquidity providers. Upgrades, gate and registrar changes, and replacing the servicing wallet or an institution are listed but not offered: a mistake would break the deployment.
  - **One card per proposal:** each institution's approval, the institutions and signatures counted, when it is executable and until when, and its state (awaiting approvals, queued, executable, executed, cancelled, expired).
  - **On each card:** Approve as each institution yet to approve, Execute, which shows the refusal while not queued or not ready (S-22), and Cancel by the proposer.

## Consequences

- A controller deployed before this decision has no window. The page says so, and still works.
- **Base Sepolia:**
  - The live controller has no act to hand its roles to a successor, so the window reaches it only with a fresh deployment of the stack: new addresses and a clean ledger. That is a separate step, with the owner's go-ahead.
  - Until then, the live site's Tier 2 shows "no execution window".
- **Tested on the local chain:**
  - integration tests for S-25, S-26, S-22, S-24 and cancellation;
  - browser spec `13-governance`.
