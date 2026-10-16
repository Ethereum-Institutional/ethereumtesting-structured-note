# 0106. Addresses shown short, and linked to the explorer

- **Status:** Accepted
- **Date:** 16 October 2026

## Context

The owner asked for wallet and identity addresses to link to Etherscan on Ethereum Sepolia. Most
pages printed them as plain 42-character text, which broke mid-address in narrow columns and on
phones. The site already knew each chain's explorer (`lib/explorer.ts`, with Sepolia Etherscan for
chain 11155111), but used it only for transactions and the note's contracts.

## Decision

**One `Address` component shows every wallet, identity, account and claim issuer.** It shows the
address's start and end (`0x6df878…419e`), links to the chain's explorer in a new tab, and carries
the whole address in its tooltip. On the local chain, which has no explorer, it is not a link.

**The middle stays in the text, hidden.** Searching the page, a screen reader and copying the
address all get it whole, and the tests that find a row by its full wallet still do.

**Where it applies:**
- the bank's onboarding and pool pages;
- the onboarding agent's pages;
- the Agent's participants and note pages;
- the custodians' accounts;
- the client's Onboard page.

The Custodians page also stops putting each custodian's operator address in its heading: the
address now sits in a line below it.

## Consequences

**On-screen copy.** The address on screen shows its ends only. Its full form is in the tooltip,
the link and the clipboard.

**Tests:**
- browser specs 03, 08 and 09 find accounts by their full address, and still do;
- spec 15 finds no page wider than a phone.
