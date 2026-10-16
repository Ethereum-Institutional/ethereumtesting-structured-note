# The site

Five portals behind one sign-in:
- **the bank:** sign-ups, clients, onboarding, its deposit, the conversion pool;
- **the onboarding agent:** requests for the notes, the clients it vouches for, identities brought from elsewhere;
- **the custodians:** segregated client accounts;
- **the Agent:** notes, reconciliation, governance, keys, the audit log;
- **the client:** its accounts, conversion, its notes.

Signed-in visitors also see the architecture, the solution overview and the Ledger.

## Sign-in

1. A visitor registers with a name, an organisation and a work email. A six-digit code is sent to the address, together with a link to the page that takes it.
2. A code lasts ten minutes and works once. Five wrong tries spend it, and asking for a new one retires the one before.
3. The first code confirms the address. An address listed in `OPERATOR_EMAILS`, or on a domain in `AUTO_APPROVE_DOMAINS`, is approved at once. Any other waits for the bank's staff, who are emailed.
4. Staff approve or revoke at `/bank`. An admin, listed in `OPERATOR_EMAILS`, may also delete a registration that has nothing on the chain.

**What the site never reveals.** A request for a code returns the same answer whether or not the
address is known, and a wrong code reads the same as an unknown address. Codes are limited to one
a minute per address.

**What the site keeps.** Only salted hashes of codes and hashes of session identifiers are stored.
Every registration, sign-in and decision goes in the audit log.

## Configuration

| Variable | Required | Purpose |
|---|---|---|
| `SITE_URL` | production | The site's own origin: links in mail, and each term sheet's published address |
| `POSTGRES_URL` | production | The store. Production refuses to start without it |
| `RESEND_API_KEY`, `MAIL_FROM` | production | Mail. Without them no code is sent, and a code is never shown on screen instead |
| `OPERATOR_EMAILS` | yes | Staff with every portal, and the admins |
| `BANK_EMAILS`, `ONBOARDING_EMAILS`, `AGENT_EMAILS`, `CUSTODIAN_EMAILS` | no | Staff with one portal each |
| `AUTO_APPROVE_DOMAINS` | no | Domains whose addresses are approved once confirmed. Exact match; subdomains excluded |
| `MANIFEST_PATH` or `MANIFEST_JSON` | yes | The deployment the site works on |
| `RPC_URL`, `LEDGER_RPC_URL` | yes | The chain, and the RPC the Ledger reads history through |
| `SIGNER_KEYS` | yes | The keys the site signs with, by capacity. Sensitive |

In development, mail is written to the server log, and the store is `site/.data/store.json`.

## Commands

```
npm install
npm run dev                          # the site on port 3020, against the local chain
npm test                             # unit tests
npm run typecheck
../ops/reset.sh && npm run test:admission   # integration tests on the local chain
../ops/reset.sh && npm run test:browser     # every portal, clicked through in Chromium
npm run test:local                   # all of the above, on a fresh local chain
```

**Where tests run.** Every test runs on the local chain, and none sends a transaction to a public
network. The integration and browser tests read through a proxy that answers a block behind just
after a transaction, as a load-balanced public RPC does (`test/lagging-rpc.ts`).

**When to run what.** Run the tests that cover a change before deploying it, and the whole local
suite before a release is tagged. Install Chromium once, with `npx playwright install chromium`.

**Deploying.** The overview is copied from `docs/solution-overview.html` at build time, so the
repository keeps one copy. Deploy from the repository root, with the Vercel project's root
directory set to `site`, so that `docs/` is present at build.

## Chain library

| Module | Does |
|---|---|
| `lib/chain/manifest.ts` | Loads and checks the deployment manifest; names every address it holds |
| `lib/chain/signer.ts`, `queue.ts` | Signing by capacity, one queue per key; checks a key can pay the fees first |
| `lib/chain/safe.ts` | Acting through a multi-signature wallet |
| `lib/chain/tape.ts` | The audit tape: every call named by its contract and function, unrecognised calls kept and marked |
| `lib/chain/until.ts` | Waiting for a read to show a transaction just made |
