# 0089. Onboarding by role: five portals, custody routes on identities, and no credential platform

- **Status:** Accepted (owner, 14 October 2026), as workstream 2 of 0.2.0
- **Date:** 14 October 2026

## Context

0.2.0 onboards clients through ERC-3643 identities and claims (ADRs 0085 to 0088), and removes the
external credential platform (plan, decision 5; Q1 to Q6). The site's onboarding was built on that
platform: credential presentations by QR, a hosted verifier, an issuer server, anchoring, and
grants in our own registry.

The owner chose:
- **Portals:** one sign-in, with role lists.
- **Self-custody:** the bank sets the identity up, then hands it over.

## Decision

### Portals and roles

**Five portals** behind one sign-in:

| Portal | Path | What it holds |
|---|---|---|
| The bank | `/bank` | Sign-ups, its clients' KYB records, the routes it confirms, the deposit claim and its revocation, the deposit's credits |
| The onboarding agent | `/onboarding` | Requests for the note, the note claim and its revocation, identities brought from elsewhere |
| The Agent | `/agent` | The notes, their lifecycle, governance, keys and the Ledger, with participants shown as wallets, identities and the issuers that vouched for them, and never client facts |
| The custodians | `/custodian` | The bank's custody platform and a third-party custodian: the accounts each opens, and the identities each manages |
| The client | `/onboard` | Its route, its wallet, its request for the note, and its notes |

**Roles:**
- Each staff portal has its own email list: `BANK_EMAILS`, `ONBOARDING_EMAILS`, `AGENT_EMAILS` and `CUSTODIAN_EMAILS`.
- `OPERATOR_EMAILS` grants all four, so one person can demonstrate every role, switching between them in the navigation.
- A portal shows only its own records.

### The client's journey: onboarded for the deposit, then access to the note

1. **Register.** The client registers and the bank approves the sign-up.
2. **The bank's KYB record.** Bank staff enter the client's facts once.
   - The record stays in the bank's portal, with a random salt.
   - Its hash is what a claim carries (Q1).
3. **A custody route.** The client chooses one, and the bank confirms it against the KYB record.

   | Route | Who opens the account | Who manages the identity |
   |---|---|---|
   | Bank custody | The bank's custody platform opens a segregated custody account | The custody platform |
   | Third-party custodian | The custodian, in its portal | The custodian |
   | Self-custody | The client brings its own wallet | The client (see below) |

   **For self-custody:**
   - The client signs one EIP-712 message (Q4). It states the wallet, that the client takes over the identity's management, and its consent to the bank and the onboarding agent vouching for it.
   - The signature is checked by recovery, or by EIP-1271 for a contract wallet.
   - The bank creates the identity, records the consent as claim keys, registers the wallet and adds its claim.
   - The bank then makes the wallet the identity's manager and removes itself. The client signs once and pays nothing.
4. **The deposit.** For every route, the bank's claim makes the wallet eligible for the deposit as soon as it is added. There is no anchoring wait.
5. **The note.** The client asks for access to the note, answering the selling-restriction questions.
   - The onboarding agent sees that the bank's claim stands, which the client's consent lets it rely on, and the answers.
   - It adds the note claim, carrying the hash of its own record.
6. **An identity brought from elsewhere** (Q2):
   - A client whose identity already carries the note claim from an issuer the note trusts signs once for its wallet.
   - The onboarding agent registers that wallet against it, without checking again.

**Revocation** is immediate, by the issuer of each claim:
- the bank's claim in the bank's portal;
- the note claim in the onboarding agent's.

**Re-screening** is a fresh claim, as the claims lapse (ADR 0088).

### What the platform's pieces become

| Was | Is |
|---|---|
| The bank's issuer server, signing a corporate identity | The KYB record in the bank's portal, and the bank's claim |
| The wallet-control credential | The EIP-712 signature, and the wallet registered against the identity |
| The holder-wallet route by QR | An identity brought from elsewhere |
| Anchoring | Nothing |
| Assessment and grants | Claims, and each token's identity registry and compliance |
| The platform's settings, keys, schemas, DIDs and registries | Removed |

The deployment no longer installs the platform's registries. Its local issuer key becomes a
**third-party custodian** (`THIRD_PARTY_CUSTODIAN_PK`).

### The onboarding record

The participant record keeps its table, `admissions`, so placement and the Ledger read it as before.
- **`route`:** `bank-custody`, `third-party`, `self-custody` or `existing-identity`.
- **`status`:** `requested`, `awaiting-wallet`, `awaiting-custodian`, `onboarded`, `declined`, `cancelled`, `offboarded` or `failed`.
- **`data`:** the wallet and identity, the claims each institution added, and the note's own request and decision.

## Consequences

- **The conversion pool is off by default.** Its gate is rebuilt on the same identities in workstream 6. Until then it is deployed only with `POOL=1`. *Superseded by ADR 0090: the pool is on by default, gated on the same identities.*
- **The bank's custody platform and the third-party custodian** each operate their own custody account factory. The deployment opens accounts for both and onboards them by role (`script/04_DeployCustody.s.sol`).
- **ADRs resting on the platform** (0040 to 0070 where they concern it) are superseded by this one and ADR 0088, kept as history (Q6).
