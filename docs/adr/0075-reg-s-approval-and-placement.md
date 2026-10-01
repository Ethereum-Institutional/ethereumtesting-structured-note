# 0075. Approval for the note under Reg S, and placement by DvP from the site

- **Status:** Accepted (owner, 1 October 2026)
- **Date:** 1 October 2026

## Context

ADR 0072 chose that staff approve each client for the note under Regulation S, and that the
site's keys play the Issuer's side while clients sign their own. An admitted account carries a
registry grant without the Reg S flag, so the note's gate refuses to move units to it (S-09).
Placement (S-08) is the DvP settlement contract's propose and accept: the units and the price
move in one transaction, or neither does.

## Options

1. **Approval:**
   - (a) staff approve per account, with a confirmation that the client is not a U.S. person;
   - (b) the flag is set on every admission.
   
   (b) would make S-09 untestable and skip a real selling restriction.
2. **Placement:**
   - (a) the Issuer proposes and the buyer accepts: a custody account through the custodian in the same action, a client's own wallet in MetaMask;
   - (b) the site accepts for every buyer.
   
   (b) would make the site sign for wallets it does not hold.
3. **Refusal:**
   - (a) ask the note's `canTransfer` before anything is sent, and say why;
   - (b) send, and show the revert.

## Decision

1(a), 2(a), 3(a).
- **Approval for the note.** "Approve for the note…" on an admitted account in Admissions has the
  Access Issuer rewrite the account's grant with `REG_S` added. The expiry, jurisdiction,
  credential reference and commitment are kept, and the site waits until the flag is visible.
- **Placing units.** The Notes page has a placement form for each issued note: account, units, and a price a unit
  (€1,000 by default). The Issuer allows the settlement contract the units and proposes, with a
  24-hour deadline.
  - A custody account accepts through the custodian in one `execute`: the price's allowance, then the acceptance.
  - A client's own wallet sees the offer on its Notes page, and accepts it with MetaMask in two transactions.
- **Refusals.** The note's own answer comes first: a missing Reg S flag is refused as S-09, and
  a record time with transfers stopped is refused with its reason.
- **Withdrawing an offer.** Staff can withdraw an offer that has not been accepted; it is cancelled on-chain.

## Consequences

- Placements are recorded on the note (`data.placements`) with their transactions; the chain
  remains the authority, read again whenever an offer's state matters.
- Every step that relies on the one before it waits for it to be visible, because a load-balanced
  RPC may answer from the previous block (ADR 0059).
- Tested on the local chain:
  - the integration tests (S-09 then S-08 for a wallet; S-08 for a custody account);
  - the browser spec `09-placement`.
