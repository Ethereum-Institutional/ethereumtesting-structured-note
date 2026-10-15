# 0094. A reconciliation statement for every note, as at any day, now or a block

- **Status:** Accepted (owner, 15 October 2026), as workstream 7 of 0.2.0
- **Date:** 15 October 2026

## Context

The bank's success criteria include registry reconciliation and day-to-day reconciliation (7 of
its 9). The close-out statement (ADR 0084) reconciled a note once it had redeemed: read from the
chain alone, at one block. But it covered only notes issued from the site, and only at the end.

The plan asked for the close-out to be generalised into a statement at any block, covering:
- positions;
- cash;
- open offers;
- distributions due and held.

The plan also asked that the statement can be downloaded daily, and that it says closed once the
note has redeemed. The owner said the data could start afresh, with no older records to carry.

## Decision

The owner chose all four as recommended, and settled the first by starting afresh.

### Every note going forward

The statement covers every note the note factory issued (ADR 0091), the deployment's note under
review and each note issued from the site alike. It reads them from the factory's own record on
the chain, where every note is now issued. Nothing older is carried.

### As at a day, now, or a block

- **A day.** A statement as at a day is read at that day's last block (UTC), the close of business. On the chain's current day it is read at the latest block, and says "so far".
- **Now** is the latest block.
- **A block** can also be given.
- **Refusals.** A day before the note's issuance is refused, and so is a block not yet mined.
- **One block for everything.** Every figure is read at the statement's one block, the lifecycle and the offers included, so the statement is one moment of the chain and anyone with the chain can reproduce it.

### Downloaded on demand, any day

The note's page lists each day since issuance, newest first, each with its statement to download.
A statement is built from the chain when asked, and nothing is stored, so nothing can drift from
the chain. The same day's statement is the same each time it is built.

### JSON and CSV

- **JSON** carries every figure and check, for the evidence pack.
- **CSV** carries the positions, one row per account with amounts in euros, for a bank's reconciliation tools.

### What a statement says

**Positions.** For every account the note ever moved to or from:
- units in and out, and the balance;
- the units its open offers lock;
- whether it is eligible for the note at the block;
- the coupons and redemption paid to it, and anything held for it.

**Cash:**
- what the Paying Agent holds, and what it owes;
- what the settlement contract holds;
- the Agent's funding, and how much of it the Paying Agent may draw;
- the units in the Issuer's inventory.

**Distributions.** Each one opened, with its units paid of those entitled, and what it paid, holds
and still owes.

**Open offers,** with their units, price and deadline.

**Checks that hold on any day:**
- the supply is the sum of the balances;
- every position reconciles: units in less units out equals the balance;
- every holder is eligible for the note: KYC whitelist enforcement, criterion 5;
- the locked units are the open offers';
- the Paying Agent holds exactly what it owes: the unpaid part of its open distributions and what it holds for holders;
- the settlement contract holds no cash between settlements.

**Once the note has redeemed,** the close-out's checks are added (ADR 0084). The statement then
says "Closed" only when every check passes. Otherwise it is "Redeemed, not closed", or, for a live
note, "Reconciled" or "Not reconciled", with the failing checks named.

### Where

A **Reconciliation** page in the Agent's portal lists every note, each with its statements by day.
Each note's own page shows its statement now, in place of the close-out.

## Consequences

- **The close-out statement and its route** are folded into this one and removed. ADR 0084's checks live on as the redeemed note's.
- **The lifecycle and offers readers** take an optional block to read at.
- **Distributions not yet opened** are listed in the note's lifecycle, not in the statement's cash: their amount is fixed only at their record time.
- **The bank's own reconciliation of its deposit** is on its Deposit page (ADR 0092). This statement is the note's.
- **Tests:**
  - integration: a note mid-life reconciles with every any-day check passing; redeemed, it closes; read again at an earlier block, it gives the figures it gave then; the CSV carries every position; the deployment's note under review reconciles, and a day before its issuance is refused;
  - browser: `14-reconciliation` lists the notes, reads the note under review now and as at a day, and downloads both formats, which the bank's staff cannot; `10-lifecycle` reads a redeemed note's statement with money held.
