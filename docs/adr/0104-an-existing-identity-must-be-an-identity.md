# 0104. An identity brought to the site must be an ONCHAINID identity

- **Status:** Accepted
- **Date:** 16 October 2026

## Context

On the existing-identity route (ADR 0089), a client gives the address of an identity they already
hold. On Ethereum Sepolia a client gave a wallet's address there, the same address as the wallet
they then signed with. The site accepted it without checking. The onboarding agent registered the
wallet against that address in the shared identity storage. From then on the deposit's registry
reverted whenever it checked the wallet, because there was no identity contract to read claims
from. The raw contract error reached the page.

## Decision

**An identity must be an ONCHAINID identity.** The address must hold code and answer the key
manager's `keyHasPurpose`, as every identity does. Both the client's request and the onboarding
agent's acceptance check it. A wallet cannot be its own identity.

**A registration made before this check is undone.** Accepting such a request again declines it
and removes the wallet from the identity storage.

**A reverting registry check reads as "not verified"**, as the transfer itself would fail, and a
claim on an address that is not an identity reads as absent. A page shows the state instead of
the error.

## Consequences

**The wallet registered on Ethereum Sepolia.** Once this is deployed, the onboarding agent accepts
that request again. It is declined, and the registration is undone.

**Test.** The onboarding integration test refuses a wallet's address given as the identity. It then
recreates the case: a wallet registered against itself, accepted again, declined, and its
registration gone.
