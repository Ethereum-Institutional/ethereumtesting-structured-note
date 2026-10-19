# 0009. The note factory and issuance

- **Status:** Accepted
- **Date:** 16 October 2026

## Context

A programme issues many notes, sometimes several at once. Each must be issued whole and under
governance from its first block, with nothing left for a single key to change afterwards. One
note's fault must not reach another's balances, and issuance must stay cheap enough to run often.

## Decision

**`NoteFactory`, owned by the Issuer's multi-signature wallet.** Two of the wallet's three signers
issue. The factory owns T-REX's factory, so no note can be issued around it.

**One transaction issues a note whole** (`issue`, or `issueMany` for several):
1. assigns the next **series number**, and takes an **ISIN** where one is given (twelve
   characters, or none);
2. clones the note's **Determination Agent** and **record-date module** from fixed
   implementations, and fixes its terms;
3. issues the **T-REX suite** on the shared identity storage, requiring the note claim from the
   onboarding agent's issuer, plus up to four further claims the series names, and carrying the
   record-date and sanctions modules;
4. states on the note's identity its **term sheet** (hash and address) and its **series** (number
   and ISIN);
5. clones the note's **Paying Agent** and **settlement contract**;
6. makes each of them, and the controller, an agent with only its own powers (record 0008);
7. mints the notional to the **Issuer's inventory** and opens the note for transfers;
8. **allowlists** the Paying Agent and settlement contract on the deposit;
9. hands the token, its registries and compliance, and the management of its identity, to the
   **governance controller**, which accepts them in the same transaction (`adopt`).

The factory keeps a record of every note and its contracts (`notes`, `noteOf`, `tokenOfSeries`,
the `NoteIssued` event), which the site and the event index read.

**Clones, one set per note.** The four lifecycle contracts are EIP-1167 minimal clones of
implementations deployed once with the scaffolding, each initialised once in the transaction that
creates it. The implementations themselves can never be initialised.

| Option | Chosen? | Why |
|---|---|---|
| Minimal clones per note | Yes | Each note keeps its own determinations, record dates, Paying Agent and settlement, so one note's fault cannot touch another's; issuance stays cheap |
| One programme Paying Agent and settlement | No | Cheapest, but a fault or pause there would reach the whole book |
| Full contracts deployed per note | No | Their creation code together exceeds what one contract may hold, so the factory would need helper deployers, and every note would cost far more |

| Option | Chosen? | Why |
|---|---|---|
| The Issuer's multi-signature wallet owns the factory | Yes | No single key can issue |
| The Issuer's single key | No | One compromised key could issue |
| The governance controller | No | The decision to issue belongs to the Issuer, not the Agent |

**Identifiers.** The factory's series number is unique and always present; the ISIN is entered by
staff when the note has one. Both are in the factory's record and on the note's identity.

**Stewardship of the identity storage,** on the controller's Tier 2 act only:
- `retire` unbinds a redeemed note's registry (terminated, and no units left) from the storage,
  which binds at most 300 registries. T-REX's factory has no such act, so the programme's
  `ProgrammeTREXFactory` adds it.
- `releaseTrexFactory` hands T-REX's factory, and with it the storage and every identity in it, to
  a successor factory.

**On the site,** issuance runs as two steps: the Issuer's wallet issues (two owners' keys sign the
wallet's transaction, simulated first so a refusal is the factory's own reason), then the bank
credits the Agent's deposit account for the note's distributions. Each step is claimed in the
database before it runs and is safe to run again: a rerun first looks in the factory's events for
a note this issuance already made, by its name and symbol, and picks it up rather than issuing a
second. A claim older than any request can run is released; staff can stop an issuance, and
whatever reached the chain stays.

## Consequences

- The Issuer's part ends at issuance; every later act on a note is governance or servicing.
- Several notes can be issued in one transaction.
- A note issued is a note governed: there is no window in which it belongs to anyone else.
