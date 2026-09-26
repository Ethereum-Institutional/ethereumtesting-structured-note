# 0054. Three routes into the pool: custodied by default, self-custody through the bank, and the holder wallet

- **Status:** Accepted (owner, 26 September 2026)
- **Date:** 26 September 2026

## Context

ADRs 0045 to 0050 made the holder wallet the way in: an officer scans QR codes to present
credentials. Most institutions will not run a holder wallet. Their bank has already verified them
(KYB) and will usually custody the asset; some will hold their own wallet, often with a third
party; a few will want to carry portable credentials. The pool's on-chain rule does not depend on
who presents: it needs a bounded, revocable grant for a wallet the participant controls, resting
on the bank's KYB.

## Options considered

| Option | Summary |
|---|---|
| Three routes, one rule | Custodied (default): the bank writes the grants for a custody account from its own records on the client's instruction. Self-custody: the client signs one message from its own wallet on the bank's portal, and the bank writes the grants. Holder wallet: the QR flow of ADR 0045. |
| Holder wallet only | As built in ADRs 0045 to 0050. |
| Custodied only | Simplest, but closes self-custody and portable credentials. |

## Decision

All three routes are supported and end in the same two grants.

1. **Custodied, the default.** The client instructs its bank or custodian in its usual channel.
   The custodian opens a segregated custody account; the bank's onboarding system (the Access
   Issuer) mints the wallet-control credential for it, signed by the custody account (EIP-1271),
   and writes both grants citing the client's corporate identity and its own record. The client
   installs, scans and signs nothing on-chain.
2. **Self-custody through the bank.** On the bank's portal, where the client is already known, the
   client signs one wallet-control message from the wallet it already uses (EIP-712, or EIP-1271 for
   a contract wallet on this chain). The bank mints the wallet credential and, after its own review,
   writes both grants. A third party may hold the wallet.
3. **Holder wallet.** The QR flow of ADR 0045, for clients who carry their credentials.

The Access Issuer is operated by the bank. The officer credential (ADR 0049) becomes a policy of
each gate, off by default, because the bank's KYB already establishes who may act for the client;
ADRs 0046, 0049 and 0050 describe the holder-wallet route when that policy is on. The Access
Issuer's operator approval (ADR 0048) is the review step in every route.

## Why

The owner's position: the common case should cost the client almost nothing, and the bank already
holds what the grant rests on. Keeping self-custody and portable credentials open preserves the
open-banking path without making it everyone's burden.

## Consequences

- Credentials still exist and revocation stays public: the bank issues them behind the scenes.
- The site plays the bank's portal for the PoC: a staff screen for custodied admissions, a client
  screen for self-custody, and the QR flow.
- The bank's issuer backend is reached through its operator API (credential listing by customer
  reference, wallet-control issuance); its RPC must reach the pool's chain to check a custody
  account's signature.
- In the custodied and self-custody routes the jurisdiction and status come from the bank's
  records, stated by the bank; the credential identifier is what makes the grant revocable.
