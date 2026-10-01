# 0080. ETH for fees: a Keys page, a check before every transaction, and top-ups

- **Status:** Accepted (owner, 1 October 2026)
- **Date:** 1 October 2026

## Context

The first live determination failed with "gas required exceeds allowance (0)". The Calculation
Agent's key had only ever signed, so it held no ETH on Base Sepolia. Nothing showed which of the
site's keys held how much, and the network's message did not say which key was short.

## Options

1. **Before a transaction:**
   - (a) refuse if the key cannot pay twice the estimated fees, and warn when it is below a buffer;
   - (b) refuse below the buffer;
   - (c) warn only.
2. **Topping up:**
   - (a) a button that sends from the best-funded site key;
   - (b) addresses and faucets only.

## Decision

1(a) and 2(a), chosen by the owner.
- **The check.** Before every transaction the site sends (call, deployment or transfer), the signer estimates its gas and the fee per gas. It refuses before signing if the key holds less than twice that. The message names the key's role and address, its balance and what is needed.
  - An estimate that fails is left to the transaction itself, with a ceiling assumed for the check.
  - A refusal by the network for want of fees is reported in the same words.
- **Low keys.** A key below the buffer is low: `FEE_BUFFER_ETH`, by default 0.001 ETH, about 500 typical transactions on Base Sepolia today. Its transactions still go ahead, but every Operator page shows a warning naming it, and the navigation counts it.
- **The Keys page.** Operator → Keys lists every key the site holds: its role, address (linked), ETH, and transactions left at today's fees. The servicing wallet's owners are shown as signing only: they need no ETH, because the Agent sends the wallet's transactions.
- **Top up.** A low or empty key has a Top up button. It sends `TOP_UP_ETH`, by default 0.003 ETH, from the best-funded site key, which must keep the buffer afterwards. Each top-up is in the audit log.
- **Client wallets.** Before MetaMask is asked to send anything (converting, or accepting an offer), the page checks that the client's wallet can pay twice the estimated fees. If not, it says what is needed instead of asking.

## Consequences

- An empty key is found before a transaction fails, and topped up in a click while any site key has ETH. Refilling the best-funded key itself is from a faucet; the page links Base Sepolia's.
- The check adds a balance read and an estimate to each transaction, which is negligible next to waiting for a receipt.
