# 0019. The term sheet as a record

- **Status:** Accepted
- **Date:** 16 October 2026

## Context

A note's terms on the chain must be exactly the terms the Issuer agreed, and anyone holding the
term sheet must be able to check it against the note. A term sheet kept beside issuance, with only
its hash anchored, can drift from what was issued. A desk issues each note from the term sheet,
with its ISIN.

## Decision

**A typed record, every field present** (`site/lib/notes/termsheet.ts`, schema
`structured-note-term-sheet/1`):
- Each field has an identifier, a label, a type, a priority (must, should, could), an example, and
  whether it may be "not applicable". The fields cover identification (name, symbol, ISIN,
  currency, size, dates, network, selling restrictions, governing law), the parties, the
  underlyings, the payoff, the observation calendar and settlement.
- Every field carries a value or an explicit "not applicable", with a reason where one helps. An
  absent field is an error.
- Rules across fields: Twin Win's participations apply together or not at all; an early-redemption
  trigger is given on exactly the dates its test applies.
- The fields are a catalogue: fitting the bank's own field list means editing the catalogue alone.

**Its hash.** keccak256 of the record's canonical JSON: keys sorted, no whitespace, no fractions,
so no value can be written two ways. Anyone given the record can check it against the chain.

**The input to issuance.** The terms the Determination Agent fixes are derived from the record
(`toTerms`), and nowhere else. The note's identity carries the record's hash and its address.

**Where a record comes from:**
- **Uploaded by staff.** Staff upload or paste the record. Before anything is sent it is checked:
  the schema; every field present or not applicable; this network; the ISIN's check digit; an
  issue size of 1 to 1,000,000 units; the first Record Time still at least a minute away; and a
  symbol and ISIN not already used. The record is then the note's terms, name, symbol, size, ISIN
  and calendar, and the site never edits it.
- **Built from a scenario,** for showing a lifecycle quickly: the site builds the record from the
  scenario's terms and the chosen calendar, with the ISIN given.
- **The deployment's own note:** `site/scripts/term-sheet.ts` builds its record, dated from the
  chain's clock, before issuance; it goes into the manifest.

**Published by the site, behind sign-in.** Each record is kept by its hash (content-addressed, never
replaced) and served at `/term-sheets/<hash>`, the address the note's identity carries, to signed-in,
approved users, in its canonical form, so the bytes received hash to the address they came from.

**Checked against the chain.** Each note's reconciliation statement includes "the term sheet
matches the note", comparing the record's terms with the Determination Agent's, field by field.

| Option | Chosen? | Why |
|---|---|---|
| The record is the input to issuance | Yes | The chain's terms and the record cannot drift without a check saying so |
| The record beside issuance, its hash anchored | No | The two could drift |
| Public publication | No | A real term sheet is often restricted by its selling rules |

## Consequences

- A note's identity points to the Issuer's own document.
- An uploaded note has no scenario, so the site offers no suggested Levels for it.
