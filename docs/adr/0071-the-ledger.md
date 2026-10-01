# 0071. The Ledger: the lifecycle from the chain alone, through Alchemy, with a register reconciliation for staff

- **Status:** Accepted (owner, 30 September 2026)
- **Date:** 30 September 2026

## Context

S-35 requires the lifecycle to be reconstructed from chain events alone, and S-36 requires that no
deployed contract or event carries personal data. The chain library's tape decoded calls, but
nothing showed them. Public Base Sepolia endpoints refuse log queries over the deployment's range.

## Decisions (each put to the owner with options)

1. **History:** read through Alchemy. The owner supplied the key, and it is stored in the
   integration key file and as a sensitive production setting (`LEDGER_RPC_URL`). *Rejected:* the
   site's own index built from the public RPC; reading the public RPC on every visit; a block
   explorer's API.
2. **Storage:** read on each visit and cache for a minute. Nothing is stored, so the reconstruction
   from the chain is what happens every time. *Rejected:* an index in Postgres.
3. **Audience:** every approved user sees the Ledger. Only staff see the register reconciliation,
   which pairs on-chain accounts with the bank's clients. *Rejected:* staff only; everything for everyone.
4. **S-36:** checked in the tests, not on the page. The integration run scans every transaction's
   calldata and every event for the site's client and personal data, and for anything shaped like
   an email address. *Rejected:* a scan shown on the page; a note only.

## How it works

- History starts from the deployment's first block, found by binary search on when the Identity
  Registry first has code.
- On a public network only the deployment's own contracts are read. The shared ones (pool
  manager, Permit2, WETH, the third-party payment token, the Safe factory) carry everyone's traffic.
  Custody accounts are learned from the factory's own `CustodyAccountCreated` events.
- The tape names MetaMask's delegation manager, through which smart-account wallets send, but
  never watches it.
- The reconciliation covers every account granted on-chain or onboarded by the site. It compares
  the pool grant, registry flags and balances with the site's client, route and status, and flags
  a disagreement in red. Grants made by the deployment itself are noted, not flagged.

## Consequences

- **S-36 found a leak in this project's own work before it spread:** ADR 0067's custody reference
  put the client reference in the factory's calldata. It is now opaque (ADR 0067 as amended). One
  account opened on the test network carries the old form, a site-assigned reference with no
  personal data in it.
- **The reconciliation's first finding is real:** a grant voided on-chain after its credential
  was revoked at the bank is still recorded as admitted by the site until staff offboard it.
- The lagging-RPC test proxy now lags only behind the newest receipt it has seen. A node behind is
  behind the head, and reading old receipts must not move it back in history.
