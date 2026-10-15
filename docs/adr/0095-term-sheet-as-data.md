# 0095. The term sheet as data: a typed record, the input to issuance, its hash on the note

- **Status:** Accepted (owner, 15 October 2026), as workstream 8 of 0.2.0
- **Date:** 15 October 2026

## Context

The bank asked to capture a list of term-sheet fields. Each field comes with an identifier,
examples, a data type and a priority, and any field must be able to say "not applicable". The list
has not arrived yet.

Until now a note's term sheet was a hash and an address, claimed on the note's own identity:
- **locally,** the address was "pending" and the hash was of the text "term sheet, draft";
- **notes issued from the site** copied the main note's hash, although their terms differed;
- **the economic terms** lived apart, in the scenario figures and in the Determination Agent on the chain.

## Decision

The owner chose both as recommended.

### A typed record, every field present

A term sheet is a record of fields (`site/lib/notes/termsheet.ts`). Each field has:
- an identifier and a label;
- a type: text, date, timestamp, integer, basis points, cents, yes or no, a choice, or a list of items with fields of their own;
- a priority: must, should or could;
- an example;
- whether it may be "not applicable".

**Every field must be present.** Each carries a value, or an explicit "not applicable", with a
reason where one helps. An absent field is an error. "Not applicable" is refused where the field
does not allow it.

**Two rules span fields:**
- Twin Win's participations apply together, or neither.
- A Mandatory Early Redemption trigger is given on exactly the dates its test applies.

**The fields are a catalogue.** When the bank's list arrives, fitting it means editing the catalogue
alone: identifiers, labels, types, priorities, examples. The fields today are built from our
instrument terms:
- identification: name, symbol, ISIN, currency, Calculation Amount, size, price, dates, form, network, selling restrictions, governing law, listing;
- the parties;
- the underlyings;
- the payoff;
- the observation calendar;
- settlement.

### The input to issuance

The terms the Determination Agent fixes on the chain are derived from the record (`toTerms`), and
nowhere else.
- **Notes issued from the site:** each series' record is built from its scenario and calendar, kept, and issued from.
- **The deployment's own note:** `site/scripts/term-sheet.ts` builds its record before issuance, dated from the chain's clock. `IssueNote` reads the note's name, symbol, size and terms from that record, and the record goes into the manifest.

The note's identity carries the record's hash and its address. The record and the chain cannot
disagree without a check saying so: the reconciliation statement (ADR 0094) gains "The term sheet
matches the note", which compares the record's terms with the Determination Agent's, field by
field.

### Its hash

The hash is keccak256 of the record's canonical JSON. For the values a term sheet holds (strings,
integers, booleans, lists and objects), the canonical JSON is that of RFC 8785: keys sorted, no
whitespace. Any implementation of the scheme gives the same bytes, so anyone given the record can
check it against the chain. Fractions are refused, so no number can be written two ways.

### Published by the site, behind sign-in

The site serves each record at `/term-sheets/<hash>`, the address the note's identity carries, to
signed-in, approved users. It serves the canonical form, so the bytes received hash to the address
they came from. Each note's Reconciliation page shows its term sheet field by field, every "not
applicable" with its reason.

*Rejected:*
- **The record beside issuance,** with only its hash anchored: the two could drift.
- **Public publication:** a real term sheet is often restricted by its selling rules.
- **The record on the chain:** several kilobytes of gas per note, and fixed forever.

## Consequences

- **Deploy guard.** `TERM_SHEET_URI` and `TERM_SHEET_HASH` give way to `TERM_SHEET_BASE`, the site's origin, which must be set off the local node with the note's name and symbol (ADR 0027).
- **The store** keeps the site's records by hash; the deployment's record is in its manifest. A record is returned only if it still hashes to the address it was asked for at.
- **The figures are still illustrative** (spike 3) until the bank's term sheet gives them. "Not applicable" marks what the proof of concept does not have, such as an ISIN and a governing law, with the reason.
- **Tests:**
  - unit tests: every field present, "not applicable" only where allowed, the cross-field rules, the hash independent of key order, the terms derived exactly and compared field by field;
  - integration: the deployment's note and a site note each carry their own record, held and matching the chain;
  - browser: the term sheet shown field by field, the published bytes hashing to the address, and refused without sign-in.
