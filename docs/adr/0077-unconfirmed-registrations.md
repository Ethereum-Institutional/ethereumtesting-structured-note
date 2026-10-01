# 0077. Unconfirmed registrations: staff resend the link, or approve ahead of confirmation

- **Status:** Accepted (owner, 1 October 2026)
- **Date:** 1 October 2026

## Context

Registering sends a one-use link, valid for 30 minutes, to confirm the address. Until it
is used the registration is *unverified*. Access requests listed it with no action and no
explanation. Staff could not tell whether the person was waiting for them, nor do anything if the
mail went astray. Approve/Decline appeared only once the address was confirmed (*pending*).

## Options

1. Staff resend the link, or approve or decline ahead of confirmation.
2. Staff resend the link only.
3. Explain the state, with no action.

## Decision

Option 1, chosen by the owner.
- **Explanations.** Each unverified row says "Hasn't confirmed their email yet". A pending row
  says "Email confirmed; awaiting approval".
- **Resend link.** This sends a fresh confirmation link and says on the row whether it went. The
  throttle of one link a minute is reported rather than silent, and so is a mail failure.
- **Approve.** An unverified registration can be approved directly. This is safe: a session still
  starts only from a link sent to the address, so approval alone grants no access. The first link
  used then records the address as confirmed.
- **Decline.** An unverified registration can be declined, as before only for a pending one.

## Consequences

- Each resend is in the audit log.
- The browser tests read outbound mail from the stand-ins. `RESEND_API_URL` points mail there in
  tests; in production it is unset, and mail goes to Resend.
