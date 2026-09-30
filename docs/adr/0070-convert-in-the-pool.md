# 0070. Converting in the pool: both kinds of wallet, one-time approvals, faucets plus a bank credit, and a 0.5% limit

- **Status:** Accepted (owner, 30 September 2026)
- **Date:** 30 September 2026

## Context

Onboarding (routes 1 to 3) ends with a wallet admitted to the conversion pool, but nothing let an
admitted account convert (S-27), or showed a refusal for one that is not (S-28). The router takes
payment through Permit2. The live pool holds about 20 of each token at par, fee 0.05%, in one range.

## Decisions (each put to the owner with options)

1. **Who converts, and from where.** Both kinds of wallet.
   - Self-custody and holder-wallet clients convert on the Onboard page, signing in MetaMask.
   - Staff convert for custody accounts on the Operator page, on the client's instruction; the custodian's key signs through the account.

   *Rejected:* self-custody only, and custody only.
2. **Approvals.** One-time approvals, then one transaction per conversion. The first conversion
   of a token asks for the token's approval to Permit2, then Permit2's allowance to the router, for
   30 days. *Rejected:* a relayed permit signature each time; exact approvals every time.
3. **Funding.**
   - The page links to Circle's EURC faucet and to Base Sepolia gas faucets.
   - Staff get **Credit deposit**: the Deposit Agent credits EURTD through the deposit gateway,
     against a single-use booking reference the site assigns (`BKG-…`).

   *Rejected:* faucets only; the bank sending EURC and gas too.
4. **Price.** Quote first, and refuse beyond 0.5%.
   - The page shows what the pool gives, computed exactly from the pool's state.
   - The swap carries a minimum-received 0.5% below the quote and a 10-minute deadline; the swap itself enforces both.

   *Rejected:* fixed par; no limit.

## Consequences

- The site holds the Deposit Agent's key for the credit (`SIGNER_KEYS.depositAgent`).
- The deposit has two decimals, so on very small conversions the fee rounds to a whole cent. On
  1 EURTD that is about 1%, as on-chain.
- A conversion larger than the pool's single range can take is refused before signing. In the
  live pool that is about half its depth.
- Just after a credit, a lagging RPC can report the balance before it. The custodian's conversion
  re-reads for a few seconds before refusing; the lagging-RPC tests found this.
