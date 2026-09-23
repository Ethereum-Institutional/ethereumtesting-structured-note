# Registration-gated site (phase 0b)

Everything is behind the gate. The public page is a title and two forms. An approved registrant
sees the three-lane architecture, with each component linked to its section of the solution
overview, and the overview itself.

## Access flow

1. A visitor registers with name, organisation and work email, and is sent a one-time link.
2. Opening the link shows a **Continue** step. The link is consumed only when that is submitted,
   so a mail scanner that fetches links in advance cannot use it up.
3. The first confirmation verifies the address and places the registration in the approval
   queue. Operators are emailed.
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
| `OPERATOR_EMAILS` | yes | Comma-separated. Explicit list; there is no default and no domain rule |

In development, mail is written to the server log and the store is `site/.data/store.json`.

## Commands

```
npm install
OPERATOR_EMAILS=operator@example.org npm run dev > /tmp/site-dev.log 2>&1 &
rm -rf .data && npm run e2e          # 24 end-to-end checks against the dev server
npm run build && npm run typecheck
```

The overview is copied from `docs/solution-overview.html` at build time, so the repository keeps
one copy. Deploy from the repository root with the Vercel project's root directory set to `site`,
so that `docs/` is present at build.
