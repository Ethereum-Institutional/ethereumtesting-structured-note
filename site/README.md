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

In development, mail is written to the server log and the store is `site/.data/store.json`.

## Commands

```
npm install
OPERATOR_EMAILS=operator@example.org AUTO_APPROVE_DOMAINS=approved.example npm run dev > /tmp/site-dev.log 2>&1 &
rm -rf .data && npm run e2e          # 31 end-to-end checks against the dev server
npm run build && npm run typecheck
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
