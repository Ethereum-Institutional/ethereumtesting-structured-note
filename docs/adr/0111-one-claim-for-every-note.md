# 0111. One claim makes a client eligible for every note

- **Status:** Accepted
- **Date:** 16 October 2026

## Context

The owner asked whether a client's eligibility should cover "notes", not one note, now that the
factory issues many. On the chain it already does. Every note the factory issues:
- has an identity registry that reads the one shared identity storage;
- requires the same claim topic (`claim.note-eligible`);
- trusts the same issuer for it: the onboarding agent's claim issuer (`NoteFactory.sol`, at issuance).

One claim from the onboarding agent therefore makes the wallet eligible for every note issued under
the programme: the deployment's own and each series after it. The site's wording said otherwise: "Ask
for access to the note", "The note's claim", "Approve for the note".

## Decision

**Eligibility is for the programme's notes, and the site says so:**
- "Ask for access to the notes";
- "The notes' claim";
- "Approve for the notes";
- "Requests for the notes";
- "Eligible for the notes";
- "(not eligible for the notes)" in the placement lists.

The audit entries and the refusals use the same words. Text about one particular note stays
singular: placing units in it, a forced transfer in it, its own trusted issuers.

**Selling restrictions are the programme's.** The client's answers (Regulation S, the investor
class, reliance on the bank's KYB) are given once, for every note.

## Consequences

**Per-series restrictions.** If one series is ever sold under narrower restrictions, for example to
professional investors only, a single claim cannot express it. The factory would then take further
required claim topics at issuance, so that series asks for an additional claim on top of the
common one. Nothing needs that today.

**Tests.** Browser specs 02, 09 and 12 and the notes integration file use the new wording.
