# 0078. Determinations, payments and closure from the site, one step at a time

- **Status:** Accepted (owner, 1 October 2026)
- **Date:** 1 October 2026

## Context

Notes are issued and placed from the site (ADRs 0072, 0075). Their life is the lifecycle
contracts':
- the Calculation Agent determines each scheduled date: it signs the Levels and the outcome, and the Determination Agent accepts the outcome only if its own computation agrees (D1);
- the Paying Agent, driven by its payer, opens each coupon or redemption after its payment date and pays the holders of record at the Record Time, burning units at redemption. It closes each event only when every entitled unit is paid (E1 to E4).

ADR 0072 chose site-held test keys, the scenario's Levels, and a calendar chosen at issuance.

## Options

1. Staff click each step as it falls due.
2. The site determines and pays automatically while the page is open.
3. Both: steps, plus a button that runs everything due.

## Decision

Option 1, chosen by the owner.
- **A page per note.** Operator → Notes lists the notes. Each note opens on its own page with its contracts, its placements, and its lifecycle: one card per scheduled date.
- **Determining.** A date can be determined once the chain's time passes its observation date.
  - The card offers the scenario's Levels, pre-filled and editable.
  - The Calculation Agent's key signs the contract's EIP-712 digest over the Levels and the outcome the Determination Agent computes from them. Its own key then submits.
  - The card shows the outcome and, on a four-date note, whether it agrees with the independent payoff model's expected payments (`spikes/payoff`).
- **Paying.** After the payment date, "Pay the coupon" and "Pay the redemption" each run as the servicing wallet, the Agent's 2-of-3 Safe. Two owners' keys held by the site sign the Safe's transaction, and the Agent's key sends it.
  - The wallet opens the event, then pays every holder of record not yet paid, in batches of 40.
  - Holders are found from the note's own transfers, with their units read at the Record Time, so the Register is the chain's. A missing holder leaves the event open, and the page says so.
- **Held amounts.** A holder the deposit cannot credit is held for, as the contract does. "Pay what is held" claims the amount once the holder can receive it, and says why when it cannot.
- **Closure.** When a redemption closes, the note is recorded as closed and shown as redeemed. Dates after an early redemption are shown to fall away.
- **What the client sees.** Onboard → Notes lists the coupons and redemptions paid to the client's account, and any held.

Times are the chain's, so the local tests move the chain's clock instead of waiting.

## Consequences

- The Calculation Agent's "two computations" are, for the PoC, the contract's computation signed by the site. The check against an independent computation is the payoff model's, on four-date notes. A note of any other length is checked by the contract alone.
- Reading a note's lifecycle reads its events from the note's deployment block. On a public network this uses the configured RPC, which allows it for a single contract.
- Tested on the local chain:
  - integration tests: a four-date note through every date and its closure, including a held coupon and its claim; an early redemption ending the note;
  - browser spec `10-lifecycle`.
- The browser specs are numbered with two digits so that they run in order.
