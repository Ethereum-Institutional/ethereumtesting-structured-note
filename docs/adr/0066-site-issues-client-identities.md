# 0066. The site is the bank's onboarding system: staff enter a client once, and the issuer server signs and anchors it

- **Status:** Accepted (owner, 30 September 2026)
- **Date:** 30 September 2026
- **Supersedes:** ADR 0065, and the record staff typed on routes 1 and 2 (ADR 0054)

## Context

Routes 1 and 2 asked staff to restate the client's legal name, jurisdiction, status, investor
class and screening date for every admission. That was because the site could not read the
claims of a corporate identity issued in the bank's console. The owner's position: the credential platform is a
protocol, and the issuer server signs and anchors. The bank's own onboarding system is where a
client's facts are entered. That system is this site. The issuer server already lets a service
key issue: `POST /v1/issuance/initiate` and `/v1/issuance/:id/complete` under the scope
`credentials:issue`.

## Options considered

| Option | Summary |
|---|---|
| The site issues | Staff enter a client once under Clients; the site sends the claims, the server signs and anchors, and the site keeps what it sent. |
| The server returns claims | A new read endpoint at the bank. It needs server work, and the facts would still be entered elsewhere. |
| Pre-fill from the last admission | Less typing, but it still restates the bank's KYB. |

## Decision

The site issues. Under **Operator → Clients**, staff give the facts, and the site checks them
against the corporate identity schema before sending anything:
- **required:** the client's reference at the bank, legal name, legal form, registration number,
  jurisdiction, incorporation date and status;
- **optional:** investor class, the client's own DID, and its CEO, COO and CFO DIDs.

A client with no DID gets one made for it, `did:elabify:<network>:client:<reference>`, held by
no one, which suits custody. The server signs the corporate identity at once and anchors it in its
next batch. The site keeps:
- the claims as sent;
- the credential identifier;
- the pickup URL, through which a corporation's backend or a Maknoon wallet collects the credential.

Routes 1 and 2 take only the client and, for custody, the two references. The record comes from
the site's client, and the admission must rest on the credential the site issued for it.

The screening date is the issuance date (ADR 0033). A client screened more than 30 days ago is
refused with "re-screen the client first". **Re-screen** issues the same facts again, and the
earlier credential is kept on record. Corporate identities the bank holds but the site did not
issue are listed as "Issued outside this site", to be re-issued here before use.

## Why

The bank's KYB facts are entered once, by the bank's staff, in the bank's onboarding system. The
protocol and the issuer server do only what they are for: signing, anchoring and revocation. Every
route then rests on the same record.

## Consequences

- The service key needs `credentials:issue`. Wallet-control credentials still go only through wallet attestation; the server refuses them on this path.
- A client's registered address is not collected yet; the schema's field is optional.
- The stand-in bank implements both issuance steps and checks the schema's required claims, so the tests issue for real on the local chain.
