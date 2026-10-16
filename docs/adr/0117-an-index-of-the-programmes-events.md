# 0117. An index of the programme's events

- **Status:** Accepted, for release 0.3.0 (workstream 11)
- **Date:** 16 October 2026

## Context

Every page that showed a note's payments, holders, offers, Tier 1 record or the notes on record
read that note's events from the chain, over its whole life, on every load. With one note that was
slow. With a book of many notes it would not work: each page load would grow with the book, and a
public RPC limits how far back one query may reach.

## Decision

- **The index is a table of decoded events** in the site's database, for every contract the
  programme owns: the note factory, the governance controller, and each note's token, Determination
  Agent, Paying Agent and settlement. Each event is stored with the note it belongs to, its block,
  its transaction and its block's time.
- **One reader, only new blocks.** The index records the last block it has read, under a lease in
  the database, so one server reads at a time and no block is read twice. Ranges are read and kept
  one at a time, so a long first read that is cut short carries on where it stopped.
- **A note joins the index as it is issued:** the factory's events in a range are read first, and
  the new note's contracts are read in the same range.
- **Settled blocks only on a public network:** the three newest blocks are left for the chain to
  settle, so a reorganised block is never indexed. On the local chain the index reads to the head.
- **Reads catch up first.** A page asks for the events it needs; the index first reads any blocks
  since its last look. The job runner brings it up to date on every run, so page loads and the cron
  keep it current.
- **As at a block:** a statement as at a past moment reads the index up to that block.

| Option | Chosen? | Why |
|---|---|---|
| An index in the site's database, filled as blocks arrive | Yes | Pages read the book in one query whatever its size; the database is already there |
| A hosted indexer (a subgraph or similar) | No | Another service to run and pay for, and another place the deployment's addresses must be kept |
| Keep reading the chain on every load | No | Grows with the book and hits the RPC's range limits |

## Consequences

- What a page shows can lag the chain by three blocks (about 36 seconds) on a public network.
  Readings of current state (balances, a distribution's totals) still come from the chain itself.
- A fresh deployment reads its history once, from the block its identity storage was created in.
- The Ledger page still reads transactions from the chain, as it decodes calls, not events.
