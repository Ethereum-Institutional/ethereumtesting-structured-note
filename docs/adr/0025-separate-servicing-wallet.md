# 0025. The Agent runs a separate servicing wallet

- **Status:** Accepted (Wave 4)
- **Date:** 25 September 2026

## Context

ADR 0020 requires servicing roles held apart from the governance wallets, so that losing
governance does not stop servicing. Governance powers go to the controller in every case.

## Options considered

| Option | Summary |
|---|---|
| A separate Agent servicing wallet | The Agent's governance wallet sits in Tier 2 and acts alone at Tier 1; a second wallet holds servicing roles. |
| One Agent wallet for both | The governance wallet also holds servicing. |
| Everything through the controller | Servicing acts are Tier 1 controller actions too. |

## Decision

The Agent runs two wallets. The governance wallet is a Tier 2 institution and alone performs Tier 1
through the controller: register correction and supervisory withdrawal, each with a reason. The
servicing wallet holds pausing, freezing, document anchoring and paying. The Paying Agent keeps burn
and pause for redemptions; the Deposit Agent keeps the deposit's enforcement and the gateway; the
Calculation Agent keeps its signing key. The controller holds every admin role, upgrade, forced
transfer and supervisory withdrawal; the deployer ends with nothing.

## Why

Losing either wallet leaves the other working, which is what ADR 0020 requires, and routine
servicing is never signed by the keys that hold intervention powers. Routing servicing through the
controller would make every coupon run governance traffic.

## Consequences

- **Refinement taken during the build:** minting and burning outside a redemption amend the
  notional, which the overview places in Tier 2. After the ceremony the note's mint and burn roles
  sit with the controller (as the typed act `amendNotional`) and the Paying Agent (redemption
  burns only), not with the servicing wallet. Initial issuance happens before the ceremony.
- The controller can replace the servicing wallet as one Tier 2 act.
