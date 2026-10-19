# 0018. The conversion pool

- **Status:** Accepted
- **Date:** 16 October 2026

## Context

Clients hold euro stablecoins as well as the bank's deposit. A pool where an eligible client can
convert one into the other shows the deposit working in public market infrastructure. The deposit
enforces who may hold it at every transfer, so a pool must never hold it loose, and the pool needs
a perimeter of its own: not every holder of the deposit may trade.

## Decision

**A Uniswap v4 permissioned pool, on by default.** `ops/deploy-stack.sh` deploys it unless
`POOL=0`. Notes settle in the deposit alone; the pool only converts between the payment token and
the deposit.

**The parts:**
- **A permissions adapter** (Uniswap's permissioned-pool periphery) wraps the deposit. Real deposit
  moves into the adapter, which mints the matching virtual amount to the pool manager, so the
  restricted asset never sits in the pool manager. The bank allowlists the adapter and Permit2 on
  the deposit.
- **`ERC7943AllowlistChecker`** answers "what may this account do with this asset?" from the
  asset's own ERC-7943 views: it may swap only if the deposit says it can send and receive, the
  deposit is not paused, and its balance is not wholly frozen. Every read fails closed. Liquidity
  is restricted to approved providers.
- **`IdentityPoolGate`,** the pool's own perimeter, which the checker also asks. A wallet may use
  the pool when the pool's identity registry verifies its `claim.pool-access` from the bank's
  issuer; its country in the identity storage is one the pool serves (the European Economic Area,
  Switzerland and the United Kingdom, fixed at construction); and supervision has not withdrawn it.
  It never reverts, and `standing` says which test failed.
- **`PermissionedComplianceHook`** gates every swap and liquidity addition on both sides of the
  pool, refuses to initialise a pool without a verified adapter, and emits a settled-trade record
  after each swap. It checks the original wallet, recovered from the router.
- **`PermissionedSwapRouter`,** our own small router, pays through Permit2.

**Configuration:** the payment token (EURC on Ethereum Sepolia, a six-decimal stand-in locally)
against `EURTD`; fee 0.05%, tick spacing 10, opened at par; one position about 0.5% either side of
par; the bank, with an identity of its own, is the only liquidity provider.

**Governance, through the controller's typed acts:**

| Who | Acts |
|---|---|
| Servicing wallet | Switch swapping off and on |
| Tier 1 | Withdraw an account's pool access, or restore it, with a reason |
| Tier 2 | Point the checker at a new gate; approve or remove a liquidity provider; allow or refuse a router or position manager; allow or refuse a hook; trust or stop trusting a pool-access issuer |

The ceremony hands the checker, the adapter and the pool's registries to the controller, and makes
it the gate's admin and supervisor.

**On the site:**
- The bank admits a client to the pool on Bank → Conversion pool, adding its pool-access claim for
  90 days, and revokes it there.
- A client with its own wallet converts on Onboard → Convert; a custodian converts for a custody
  account. The quote is computed exactly from the pool's state; the swap carries a minimum received
  0.5% below the quote and a ten-minute deadline. The first conversion of a token asks for one-time
  approvals, through Permit2, for 30 days.

## Consequences

- Revoking or letting lapse a client's deposit claim or pool-access claim stops it trading, with
  no act at the venue.
- The pool is the bank's: its deposit, its liquidity and its clients.
