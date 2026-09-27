# 0057. The bank holds the client's reference; the client never types it

- **Status:** Accepted (owner, 27 September 2026)
- **Date:** 27 September 2026

## Context

ADR 0056 had the client give its client reference when asking the bank to confirm its KYB. The
reference is the bank's own key for its client. A client may not know it, may mistype it, and
could name another client's reference. Every client the bank would confirm already has one,
attached to the corporate identity the bank issued.

## Options considered

| Option | Summary |
|---|---|
| The bank's staff choose it | The client only asks. When confirming, staff choose the client from the bank's live corporate identities. The confirmed reference is kept with the admission, offered again on the next request, and shown on the client's page. |
| Assign it at access approval | Staff record the reference on the site account when they approve access. It adds a step to every sign-up, including clients who never use the pool. |
| The client types it | As in ADR 0056. |

## Decision

The client asks for its KYB to be confirmed and gives nothing. The bank's staff choose the
client's reference from the bank's own list of live corporate identities, which the site reads
through its service key (ADR 0055). They type it only if that list cannot be read. The confirmed
reference is kept with the admission, shown to the client, and preselected for staff the next
time the same client asks. Custodied admissions use the same list.

## Why

The bank already knows who its client is. Asking the client for the bank's own key adds friction
and gives the client a way to point at someone else's file. Choosing from the bank's list also
means staff can only select a client with a live corporate identity.

## Consequences

- `requestSelfCustody` takes no input. `reviewSelfCustody` takes the reference with the bank's record.
- The site lists up to 50 of the bank's corporate identities. A bank with more clients needs a search instead.
- Supersedes the "giving only its client reference" part of ADR 0056.
