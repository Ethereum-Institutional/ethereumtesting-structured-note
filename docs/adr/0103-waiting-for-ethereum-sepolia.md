# 0103. Waiting long enough for Ethereum Sepolia, and an issuance safe to run again

- **Status:** Accepted
- **Date:** 16 October 2026

## Context

On Ethereum Sepolia an issuance from the site failed with "the contract function issue reverted",
but issued the note anyway: Series 2, at `0x2155Bb1049d82D76B996717d82FA3C8B9a3AB855`, 20 units.
- **The cause.** The site waited 25 seconds for each transaction's receipt. That was ample on Base Sepolia's 2-second blocks. Ethereum Sepolia makes a block every 12 seconds, and the issuance is one 73M-gas transaction, which can wait longer than that.
- **What followed.** The site gave up, recorded the step as failed and ran it again. The factory then refused the same salt a second time, and that refusal is the error shown.

Replaying the call against the chain as a read-only simulation showed it sound. The factory's own
record and its events showed that the first issuance had landed.

## Decision

**The site waits up to 150 seconds for a receipt on a public network,** and 25 seconds on the local
node, which mines at once. The site's pages may run for up to 300 seconds (`maxDuration`), so the
wait fits.

**The issuance step is safe to run again.** Before issuing, it looks in the factory's `NoteIssued`
events for its own salt. If an earlier attempt landed, the step picks that note up, with its
calendar and its term sheet's hash read back from the chain at the event's block, and issues
nothing new.

| Option | Outcome |
|---|---|
| Find the earlier issuance by its salt in the factory's events | **Chosen.** It works whatever happened to the site in between, a lost function included |
| Store the transaction hash before waiting, and wait on it when run again | Not chosen. A lost function could still lose the hash |

## Consequences

**The stuck Series 2.** Run again from its page, it is picked up, and the bank's and the Agent's
steps then follow.

**Other steps.** They repeat harmlessly, an allowlist set twice for example. The bank's funding of
the Agent would credit twice, which the longer wait makes unlikely.

**Test.** An integration test issues a note, erases the site's record of the landed step, and
runs it again. It gets the same note, calendar and term sheet, and the factory holds no second
note.
