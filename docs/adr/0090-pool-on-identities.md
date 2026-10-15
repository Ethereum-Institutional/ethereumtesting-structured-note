# 0090. The conversion pool, on by default, gated on the same ONCHAINID identities

- **Status:** Accepted (owner, 14 October 2026). Amends plan 0.2.0, decision 3; carries out Q5; brings workstream 6 forward.
- **Date:** 14 October 2026

## Context

Plan 0.2.0 made the conversion pool an optional appendix, deployed only with `POOL=1` (decision 3).
Its gate, `PoolCredentialRegistry`, read the external credential platform's issuer and revocation
registries, which 0.2.0 removes (ADR 0089). Q5 settled what replaces it: the pool reads the same
ERC-3643 identities, through a pool-access claim from the bank.

The owner then asked for the Uniswap pool, with permissioning based on ONCHAINID, **enabled by
default**.

## Decision

### On by default

`ops/deploy-stack.sh` deploys the pool unless `POOL=0`. Settlement of the note is still the
tokenized deposit alone. The pool converts between the euro payment token and the deposit, as in
0.1 (S-27 to S-29).

### The gate reads a T-REX identity registry for the pool

`contracts/IdentityPoolGate.sol` replaces `PoolCredentialRegistry`. A wallet may use the pool when:

1. **The pool's identity registry verifies it.** This is a T-REX `IdentityRegistry`, deployed with the scaffolding (`instruments/script/Scaffolding.sol`), with:
   - one required topic, `claim.pool-access`;
   - one trusted issuer, the bank's claim issuer.

   It reads the deployment's one identity storage, and is never bound to it, so it cannot write.
   A wallet the bank registered for the deposit is therefore known to the pool, with no second
   register. The claim issuer's own rules decide whether a claim holds, so lapse and revocation
   stop the wallet at once, with no transaction at the gate.
2. **Its country is one the pool serves.** That is the country the identity storage records,
   checked against the 30 states of the European Economic Area, Switzerland and the United
   Kingdom (ADR 0033, by ISO 3166-1 numeric code). The list is fixed at construction.
3. **Supervision has not withdrawn it.** The controller withdraws and restores a wallet, each with
   a written reason.

`isAllowed` never reverts, and `standing` says which of the three failed. The venue checker still
requires the deposit's own eligibility, its pause and freezes, before it asks the gate.

### The bank vouches for pool access (Q5)

The bank issues the pool-access claim, from the same claim issuer that issues its deposit claim. The
claim is the same shape as every claim of the deployment (ADR 0088), and it runs at most 90 days,
the pool's longest interval between screenings. The bank's portal has a **Conversion pool** page
(`/bank/pool`), where the bank admits a client as a professional or institutional investor, and
revokes it. The pool is the bank's: its deposit, its liquidity, its clients.

The bank provides the liquidity, so it has an identity too, managed by its own key and admitted
like any participant.

### The infrastructure

The permissions adapter holds the deposit, and Permit2 moves it under allowances. Neither is a
client with an identity, so the bank allowlists both on the deposit (ADR 0086). This replaces their
grants in the retired registry.

### Governance

- **Tier 1:** withdrawing pool access, and **restoring** it, which is new.
- **Tier 2:** `SetPoolIssuer`, which replaces `SetPoolAttester` at the same position in the list of
  kinds. It trusts a claim issuer to vouch for pool access on the gate's identity registry, or
  ceases to trust one. Repointing the checker at a new gate stays Tier 2, as before.
- **Ownership:** the controller owns the pool's identity registry, its topics and its trusted
  issuers after the ceremony, whether or not the pool is deployed.

### Options considered

- **Deposit eligibility alone,** with no claim of its own. This is simpler, but the pool would then
  have no perimeter of its own: every holder of the deposit could convert. ADR 0031 keeps the
  pool's own perimeter, and Q5 named a pool-access claim.
- **A gate that reads the identity storage and a fixed issuer directly.** This is fewer contracts,
  but the issuer would be fixed in our own code. T-REX's registry makes the trusted issuers and
  topics the standard ones, governed like the note's.
- **The onboarding agent issuing the claim.** In 0.1 the Access Issuer attested pool access, so
  this would continue that. Q5 chose the bank.

## Consequences

- **Every deployment has the pool** unless it is left out. The site's conversion pages, the custody
  platform's conversion, and the pool's Ledger entries are part of the main demo again.
- **S-27 to S-29 are back in the main scenario,** shown by `test/PermissionedTrading.t.sol` and
  `test/CustodyTrading.t.sol` against the deployment, and by the browser spec
  `site/test/browser/05-pool.spec.ts`.
- **Retired:**
  - `PoolCredentialRegistry`, its test, the platform's stand-in, `script/Admission.sol`, and the
    platform's interface;
  - the platform's keys in the network template.
- **ADRs 0030 to 0037,** where they concern the credential gate, are superseded by this one and
  kept as history (Q6). ADR 0031 (the pool's own perimeter), ADR 0033 (its jurisdictions) and ADR
  0038 (the Deposit Agent as sole liquidity provider) stand.
- **Plan decision 3 is amended:** the pool is on by default, not an appendix. On Ethereum Sepolia
  the pool pairs the deposit with EURC (workstream 10).
