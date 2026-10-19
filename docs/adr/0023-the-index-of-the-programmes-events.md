# 0023. The index of the programme's events

- **Status:** Accepted
- **Date:** 16 October 2026

## Context

Pages show a note's payments, holders, offers and governance record, and the notes on record. Read
from the chain over each note's whole life on every load, that grows with the book, and a public RPC
limits how far back one query may reach.

## Decision

**A table of decoded events in the site's database,** for every contract the programme owns: the
note factory, the governance controller, and each note's token, Determination Agent, Paying Agent
and settlement contract. Each event is stored with the note it belongs to, its block, log index,
transaction and block time, under the current deployment.

- **One reader, only new blocks.** The index records the last block it has read, under a lease in
  the database, so one server reads at a time and no block is read twice. Ranges of up to 20,000
  blocks are read and kept one at a time, so a long first read that is cut short carries on where
  it stopped.
- **A note joins the index as it is issued:** the factory's events in a range are read first, and
  the new note's contracts are read in the same range.
- **Settled blocks only on a public network:** the three newest blocks are left for the chain to
  settle, so a reorganised block is never indexed. On the local chain the index reads to the head.
- **Reads catch up first.** A page asks the index for the events it needs; the index first reads any
  blocks since its last look, at most every few seconds per server. Every job run brings it up to
  date too.
- **As at a block:** a statement as at a past moment reads the index up to that block.
- A fresh deployment's index starts from the block its identity storage was created in.

| Option | Chosen? | Why |
|---|---|---|
| An index in the site's database, filled as blocks arrive | Yes | Pages read the book in one query whatever its size; the database is already there |
| A hosted indexer (a subgraph or similar) | No | Another service to run and pay for, and another place the deployment's addresses must be kept |
| Read the chain on every load | No | Grows with the book, and hits the RPC's range limits |

## Consequences

- What a page shows can lag the chain by three blocks, about 36 seconds, on a public network.
- Current state (balances, a distribution's totals, a note's dates) is still read from the chain.
- The Ledger still reads transactions from the chain, since it decodes calls, not events
  (record 0025).
