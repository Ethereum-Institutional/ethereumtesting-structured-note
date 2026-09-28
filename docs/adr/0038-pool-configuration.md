# 0038. Pool configuration: the euro payment token against the deposit, near par, one liquidity provider

- **Status:** Accepted (Wave 5)
- **Date:** 25 September 2026

## Context

The overview specifies a conversion facility between a regulated euro payment token and the
deposit, quoted in a narrow band around par, with the institution as sole liquidity provider,
inventory caps and a callable pause.

## Options considered

| Option | Summary |
|---|---|
| Fee 0.05%, spacing 10, band 0.995 to 1.005 | A visible spread for a conversion facility; about 50 ticks either side of par. |
| Fee 0.01%, spacing 1 | A tighter stable-pair configuration. |
| Fee 0.30%, spacing 60 | As the venue ran against its stand-ins. |

## Decision

- **Pair:** the euro payment token (on the test network, the issuer's 6-decimal token at the
  address in the network file; locally a 6-decimal stand-in) against the deposit, `EURTD`,
  decimals two, through its permissions adapter.
- **Fee 0.05%, tick spacing 10, opening price par,** derived from both tokens' decimals by the
  existing price code.
- **Liquidity:** the Deposit Agent only, restricted by the checker, in one position from 0.995 to
  1.005. Locally 1,000,000 each side. On the test network the deposit
  side is up to 100,000 and the position is bounded by what the Deposit Agent holds of the payment
  token, which the faucet limits. **Refined during the build:** one position, rather than a
  deposit-heavy one, so that the seed is a single act; a second, deposit-only position is a Tier 2
  question only if the test network needs deeper deposit-side inventory.
- **Inventory cap:** the size of that position, and the pause on swaps (ADR 0039).
- **Router:** our own `PermissionedSwapRouter`.

## Why

It is the overview's design with concrete values. The deposit keeps two decimals because it is a
cents-denominated liability and the instruments' surface is frozen; the pool quotes any pair of
decimals. The canonical universal router's permissioned support on the target network is
unverified, and our router keeps its surface in audit scope and small.

## Consequences

- The shipped periphery names the wrapper token "Uniswap v4 Euro Tokenized Deposit", `v4EURTD`.
- A basis between two credits (overview) remains; the pause and the position size bound it.
- Permit2 holds a settlement grant in the Identity Registry, because it moves the deposit under allowances (ADR 0013).
