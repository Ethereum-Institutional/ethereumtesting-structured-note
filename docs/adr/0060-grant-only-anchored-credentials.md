# 0060. Grants rest only on credentials anchored in the bank's registry, on every route

- **Status:** Accepted (owner, 30 September 2026)
- **Date:** 30 September 2026

## Context

The bank records every credential it issues in its own registry, whether the client is onboarded
directly or through a custodian. It anchors them in batches, about once a minute: an
`updateRoot(issuerDid, batchRoot)` call on the protocol's root registry, the one the pool gate
reads for revocations. A batch root reveals no client data. All the bank's credentials were
already anchored, custodied ones included. The site, though, wrote grants without checking
anchoring. A new wallet credential is "signed, pending anchor" for up to a minute after it is
minted. The subject of a credential may be a named individual or a corporation.

## Options considered

| Option | Summary |
|---|---|
| A. Admit in two stages | Everything up to minting the wallet credential runs at once. The admission then waits, visibly, until every credential it rests on is anchored, and only then are the grants written. |
| B. Wait inside the one request | The Admit click blocks for about 75 seconds, close to the hosting's request time limit. |
| C. Grant, then confirm | Grants are written at once and voided if the anchor never comes. This needs a scheduled job, and a grant briefly rests on an unanchored credential. |

## Decision

Option A, on all three routes. An admission whose credentials are all valid moves to
`awaiting-anchor`. The pages showing it ask the site every few seconds to move it on, and the site
writes the grants once every credential is anchored. For custodied accounts it then sets the
trading approvals. The call is safe to repeat, and the admission is claimed before anything is
sent, so two callers cannot both write.

A credential counts as anchored when the bank reports it anchored and, on the pool's chain, its
anchoring transaction:
- succeeded;
- is an `updateRoot` call;
- is for the configured issuer DID;
- was sent to the root registry the gate reads.

An anchor on another chain, for an ordinary wallet attested elsewhere (ADR 0042), is recorded on
the bank's report alone. A credential the bank has no record of, or has revoked, is refused, not
waited for. After 15 minutes without an anchor the admission fails, naming the credentials still
pending. Each anchor is recorded with the admission, and the grants' evidence hash covers it:
- the credential's own root;
- the anchoring transaction and its chain;
- the batch root.

The site accepts a credential whether its subject is a named individual or a corporation.

## Why

The registry is the bank's single record of everything it has issued, and anchoring is what makes
a credential part of that record. Nothing should be granted on a credential that is not yet in it.
Two stages keep every request short and show the client or staff what they are waiting for.
Checking the anchoring transaction on-chain means the site does not take the bank's word for it.

## Consequences

- Route 1 and route 2 admissions take about a minute longer against the live bank. The stand-in
  bank anchors three seconds after issuing, so the tests cover the waiting stage on every run.
- **Not yet provable:** that a credential is inside the anchored batch. That needs an inclusion
  proof, which the bank does not publish. Ask the protocol for one; the site would then verify
  it before writing.
- The operator page shows each admission's anchoring transactions.
