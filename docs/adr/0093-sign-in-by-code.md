# 0093. Sign-in by a six-digit code sent by email, in place of one-time links

- **Status:** Accepted (owner, 15 October 2026)
- **Date:** 15 October 2026

## Context

Access has been by registration and approval, with one-time links sent by email. Opening a link
showed a **Continue** step, so that a mail scanner fetching links in advance could not use one up,
and submitting it verified the address or started a session. The owner asked to move away from
links to a six-digit code sent by email: "It's good enough."

## Decision

**A code, typed into the page the visitor asked from.** Registering, and asking to sign in, each
send a six-digit code. The same panel then asks for it. A right code does what a confirmed link
did: it verifies the address on first use, and it starts a session once the registration is
approved. Approval by staff still gates access.

**Its limits:**
- **Ten minutes.** The code is valid for ten minutes.
- **Works once.** A code is used up by its first correct entry.
- **Spent after five wrong tries.** Five wrong entries spend it.
- **Only the newest counts.** Asking for a new code retires the one before.
- **One a minute.** Codes are throttled to one a minute per address.
- **Hashed.** Only a salted hash of a code is stored, and comparison is in constant time.

**Nothing is learned from the forms.** Every request for a code gets the same response whether or
not the address is known. A wrong code, no code, a spent or expired one, and an unknown address all
read the same. A code is never shown on screen: production refuses to issue one it cannot mail.

**Staff** send a fresh confirmation code where they sent a fresh link (ADR 0077).

**Old links.** `/access`, where links led, now says that links are no longer used.

The usual defaults were taken without a further question: ten minutes, five tries, one a minute.

## Consequences

- **The store** keeps codes in a `codes` table in place of `links`. A `links` table left in an existing database is no longer read.
- **A mail scanner cannot use a code up.** The Continue step links needed has gone.
- **Strength.** A code is six digits, so its strength rests on its limits: five tries in ten minutes against a million codes.
- **Mail stays the only outside service sign-in needs.** On the bank's virtual machine, where mail may not leave, the bundle can print codes to its log (plan, workstream 10).
- **Tests:**
  - the browser spec `00-sign-in.spec.ts` registers, confirms with a code, has staff approve, signs in with another, and shows a code working once, spent by five wrong tries, and the same answer for an unknown address;
  - `01-access.spec.ts` resends a confirmation code;
  - `test/e2e.py`, which drove the link flow at the retired `/operator` and was no longer run, is removed.
