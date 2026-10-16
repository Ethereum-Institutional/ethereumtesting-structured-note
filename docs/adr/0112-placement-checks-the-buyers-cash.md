# 0112. Placement checks the buyer's cash before offering

- **Status:** Accepted
- **Date:** 16 October 2026

## Context

On Ethereum Sepolia, placing 6 units with a custody account failed with "The contract function
execute reverted with the following signature: 0x0fc26625", undecoded. That selector is
`CashLegRefused(address,address,uint256)` from the locked settlement contract. The account held
123.00 EURTD of the deposit, and the 6 units cost 6,000.00. The Issuer's offer had already been made
before the custodian tried to accept it, so the 6 units stayed locked in an open offer.

## Decision

**Before anything is sent, placement reads the buyer's deposit** and refuses, in words, when it is
less than the price: what the buyer holds, what the units cost, and where the bank credits the
deposit (Bank → Onboarding, "Credit deposit…"). This holds for every buyer, custody account or
wallet, since an offer the buyer cannot pay for locks the units until it lapses or is withdrawn.

**A fresh credit is waited for.** The balance is read until it suffices, for about ten seconds, so
that an RPC a block behind does not refuse a credit just made.

## Consequences

**The offer from the failed attempt** stays open until it is withdrawn on the note's page (open
offers, "Withdraw") or lapses.

**Test.** An integration test places with a custody account at a price beyond its deposit. It is
refused, naming the balance and the price, and no offer is made. Browser spec 12 credits a wallet
and places with it at once, through the lagging RPC.
