# Registration-gated site (phase 0b)

Everything is behind the gate. The public page is a title and two forms. An approved registrant
sees the three-lane architecture, with each component linked to its section of the solution
overview, and the overview itself.

## Access flow

1. A visitor registers with name, organisation and work email, and is sent a one-time link.
2. Opening the link shows a **Continue** step. The link is consumed only when that is submitted,
   so a mail scanner that fetches links in advance cannot use it up.
3. The first confirmation verifies the address. An address on a domain in `AUTO_APPROVE_DOMAINS`
   is approved at once; any other joins the approval queue and operators are emailed.
4. An operator approves at `/operator`. The registrant is emailed and signs in with a new link.
5. Revocation deletes the registrant's sessions; access ends on their next request.

Every link request returns the same response whether or not the address is known. Links are
throttled to one a minute per address. Only hashes of link tokens and session identifiers are
stored. Every registration, verification, sign-in and decision is in the audit log on the operator
page.

## Configuration

| Variable | Required | Purpose |
|---|---|---|
| `SITE_URL` | production | Origin written into emailed links. Never taken from the request |
| `POSTGRES_URL` | production | Store. Without it, production refuses to start |
| `RESEND_API_KEY`, `MAIL_FROM` | production | Mail. Without them, no link is issued; links are never shown on screen |
| `OPERATOR_EMAILS` | yes | Comma-separated. Who may approve and revoke. Explicit list; no default, no domain rule |
| `AUTO_APPROVE_DOMAINS` | no | Comma-separated domains whose addresses are approved on verification. Reading access only; exact match, subdomains excluded |

### Pool admission (ADRs 0045 to 0054)

Three routes, one result: a pool grant and an Identity Registry grant, resting on the bank's KYB.

1. **Custodied, the default.** Bank staff admit a client on its instruction at `/operator`: the
   custodian opens a segregated custody account, the account signs the wallet-control message
   (EIP-1271), the bank's issuer mints the wallet credential, both grants are written and the
   account is approved to trade. One action; the client does nothing.
2. **Self-custody through the bank.** At `/admit` the client asks the bank to confirm its KYB, by
   client reference only; bank staff confirm it at `/operator`. Then the client binds a wallet:
   names it and signs the bank's message once, from a browser wallet or by pasting a signature from
   any other signer; the bank mints the wallet credential and the grants follow at once (ADR 0056).
3. **Holder wallet.** At `/admit` an officer scans two QR codes with the holder wallet; the site
   receives each presentation at `/api/admission/callback` and an operator approves.

In routes 1 and 2 the client's jurisdiction, status and screening are the bank's statement from its
file; the credential identifiers make the grant revocable. Every input is kept with the admission;
their hash is the evidence in both grants.

| Variable | Purpose |
|---|---|
| `CREDENTIAL_VERIFIER_URL` | The protocol's hosted verifier |
| `ADMISSION_VERIFIER_DID`, `ADMISSION_VERIFIER_NAME` | The Access Issuer as a verifier, as registered with the protocol |
| `ADMISSION_VERIFIER_SEED` | 32-byte seed of its ML-DSA-65 key. Sensitive |
| `ADMISSION_VERIFIER_INLINE_KEY` | `1` to put the public key in each request instead of relying on the protocol's verifier registry |
| `ADMISSION_ISSUER_DID`, `ADMISSION_ISSUER_PUBKEY` | The configured issuer and its pinned ML-DSA-65 public key (ADR 0042) |
| `ADMISSION_SCHEMAS` | JSON: `officer`, `walletControl`, `corporateIdentity` schema URIs |
| `ADMISSION_CORPORATE_ISSUERS` | JSON: corporation DID to the base address of its issuer backend, for discovery |
| `MANIFEST_JSON`, `RPC_URL` | The deployment grants are written to |
| `SIGNER_KEYS` | JSON: `accessIssuer` and `custodian` to their chain keys. Sensitive; a key management service before anything real (ADR 0048) |
| `BANK_ISSUER_URL`, `BANK_ISSUER_API_KEY` | The bank's issuer backend (HTTPS) and the service key issued to this site, scopes `credentials:read`, `wallet-attestation:eth`, `verify-requests:create` (ADR 0055). The key is sensitive |

In development, mail is written to the server log and the store is `site/.data/store.json`.

## Commands

```
npm install
OPERATOR_EMAILS=operator@example.org AUTO_APPROVE_DOMAINS=approved.example npm run dev > /tmp/site-dev.log 2>&1 &
rm -rf .data && npm run e2e          # 31 end-to-end checks against the dev server
npm run build && npm run typecheck
npm test                                                   # chain library and admission unit tests
../ops/reset.sh && npm run test:admission                  # the admission flow against the local chain
```

The overview is copied from `docs/solution-overview.html` at build time, so the repository keeps
one copy. Deploy from the repository root with the Vercel project's root directory set to `site`,
so that `docs/` is present at build.

## Chain library

`lib/chain/` is the chain-side plumbing the operations console will use from Wave 3. No page
imports it yet.

| Module | Does |
|---|---|
| `manifest.ts` | Loads and checks `ops/addresses.json` (`MANIFEST_PATH`, or `MANIFEST_JSON`); pool key and id |
| `price.ts` | Pool price from the actual currency order and both tokens' decimals |
| `tape.ts` | The audit tape: calls keyed by target contract and selector, unrecognised calls kept and marked, amounts in their own token's decimals, text never truncated |
| `queue.ts`, `signer.ts` | Signing by capacity, one queue per signer. Published local keys and the local nonce self-heal apply only on the local chain |

```
npm test                                                   # unit tests
../ops/reset.sh && MANIFEST_PATH=../ops/addresses.json npm run test:chain
```

The second decodes the local deployment's whole history and fails if the tape does not
recognise every call.
