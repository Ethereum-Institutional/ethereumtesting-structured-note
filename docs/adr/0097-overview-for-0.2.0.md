# 0097. The overview rewritten for 0.2.0, and its PDF generated from it

- **Status:** Accepted, as workstream 11 of 0.2.0
- **Date:** 15 October 2026

## Context

The bank's IT team receives two things: the code on GitHub, and a PDF of the solution overview
(plan 0.2.0). The overview described the first release:
- an identity registry of our own, with grants written from verifiable credentials through an external credential platform;
- the debt standard and its snapshots;
- Base Sepolia;
- our own success criteria.

The PDF had been made by hand, by printing the page. The repository's README and HANDOFF described
the first release too.

## Decision

**The overview is rewritten for 0.2.0, in place,** keeping its structure, its section anchors (which
the site's architecture diagram links into) and its print styles. Each section now states what is
built and recorded in ADRs 0085 to 0096:
- ERC-3643 with ONCHAINID identities and claims by role, in place of the identity registry and the credential platform;
- the bank's tokenized deposit and its acts;
- the note factory;
- the term sheet as data;
- the order of events the contracts enforce;
- the conversion pool on the same identities;
- reconciliation at any block;
- Ethereum Sepolia;
- the bank's nine success criteria, each with what demonstrates it and the evidence;
- the scenarios, each restated for what it now exercises.

Where the position changed, the overview says so plainly. Two examples:
- **Verification:** a claim's signature is now checked on-chain at every transfer, which the first release could not claim.
- **The standards not used:** the verifiable credentials model of the first release is listed there, with why ERC-3643 replaced it.

The architecture diagram on the site's home page follows the overview's.

**The PDF is generated from the HTML,** not made by hand: `site/scripts/overview-pdf.ts` prints the
page through headless Chromium with the document's own print styles, A4, numbered, to
`docs/solution-overview.pdf`. The page the site serves and the PDF the bank receives therefore come
from one source, and regenerating the PDF is one command. As before, the PDF is shared by hand
and not committed (`.gitignore`): each release regenerates it from the HTML it ships with.

**The README is rewritten** for the 0.2.0 layout, the commands and the test suites.

**HANDOFF keeps its history.** Its first section now states where 0.2.0 stands, with a table of the
workstreams and their ADRs. The sections after it are the record of how the first release was
built, kept, with the findings 0.2.0 replaced marked as such, rather than rewritten into a history
they did not have.

## Consequences

- **The overview is fitted further** when the bank's term-sheet fields and order of events arrive (workstreams 8 and 9), and when the deployment to Ethereum Sepolia gives addresses (workstream 10).
- **A dead renderer is removed from the Ledger:** the first release's registry flags, which no contract now emits.
