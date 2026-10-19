# 0020. Access, sign-in and pages

- **Status:** Accepted
- **Date:** 16 October 2026

## Context

The site is public on the internet but is for the bank's people, their clients and reviewers. Each
needs access approved by a person, a sign-in that cannot be taken over by a mail scanner or a
guessed address, and pages that explain themselves, on a desk or a phone.

## Decision

**Registration and approval.**
- A visitor registers with name, organisation and email. A code sent to the address confirms it.
- Staff approve a confirmed registration. An unconfirmed one may be approved ahead of confirmation:
  signing in still needs a code sent to the address. Staff can send a fresh confirmation code.
- Addresses on `AUTO_APPROVE_DOMAINS` (exact domain, no subdomains) are approved on confirmation;
  staff on the lists are approved by the list. Others wait for an operator, who is mailed.
- Revocation is immediate: the session is checked on every request.
- An admin (`OPERATOR_EMAILS`) may delete a registration and what is kept only for it, so the
  address may register afresh. Refused for the admin's own, and while any wallet onboarded for it
  holds an identity on the chain. The audit log keeps the deletion.

**Sign-in by a six-digit code,** typed into the page that asked for it:

| Rule | Value |
|---|---|
| Valid for | Ten minutes |
| Use | Once; asking again retires the code before |
| Wrong tries | Five spend it |
| Throttle | One code a minute per address |
| Stored | A salted hash only, compared in constant time |
| Session | Fourteen days, `__Host-` cookie, HTTP-only, its identifier stored only as a hash |

- Nothing is learned from the forms: every request for a code gets the same answer whether or not
  the address is known, and every kind of wrong code reads the same.
- The mail links to the page that takes the code for that address. The link carries the address,
  never the code.

| Option | Chosen? | Why |
|---|---|---|
| A code typed into the page | Yes | A mail scanner cannot use it up, and the mail alone signs no one in |
| A one-time link | No | Mail scanners follow links and spend them |
| A link that carries the code | No | The code would sit in the URL and browser history |

**Who sees what.** The Ledger and term sheets are for every approved user; the portals for their
staff (record 0021); a client sees its own onboarding and notes on Onboard.

**Pages:**
- **Plain English.** Every message, refusal and error says what happened and what to do, in words,
  with the contract's own reason translated. Nothing a user sees cites a decision record or calls a
  note a demonstration.
- **The look.** One dark style: near-black, cream and a pine band; Literata for headings and
  Archivo for text; the organisation's icon in crimson, marking the site as a test.
- **The screen.** The page spans the screen up to 2,400 px, with the portal's navigation at the
  left. Below 1,100 px the menu folds behind a Menu button; below 860 px a portal's tabs scroll
  sideways; below 640 px each table row reads as a card. Long addresses and hashes break rather
  than widen the page.
- **Addresses** are shown short, linked to the chain's explorer, with the whole address in the
  tooltip and in the text for search and copying.
- **Terse actions** carry a tooltip saying what they do.

## Consequences

- Access to a public site is gated by a person, and lost at once when revoked.
- Production refuses to issue a code it cannot mail, so a code is never shown on screen.
- One table component serves every table on a phone.
