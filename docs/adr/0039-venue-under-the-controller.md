# 0039. The venue is governed through typed controller acts

- **Status:** Accepted (Wave 5)
- **Date:** 25 September 2026

## Context

After Wave 4 the venue checker and the adapter were still owned by the deployer key. Section 7
forbids a general call path in the controller.

## Options considered

| Option | Summary |
|---|---|
| Typed venue acts | The controller owns the checker and the adapter and holds the credential gate's admin and supervisor roles; each permitted act is typed. |
| Institution wallets own the venue | No controller change; the venue sits outside the typed-act framework. |
| Owned by the controller, no acts | The venue is frozen except for what its contracts allow anyone. |

## Decision

- **Servicing wallet, immediately:** switch swapping off and on (`setVenueSwapping`).
- **Tier 1, the Agent's governance wallet with a reason:** withdraw an account's pool access.
- **Tier 2:** repoint the checker at a new credential gate; approve or remove a liquidity
  provider; allow or refuse a router or position manager on the adapter; allow or refuse a hook;
  appoint or remove a pool attester.
- **Handover:** the ceremony transfers the checker and the adapter to the controller, which
  accepts; it grants the controller the gate's admin and supervisor roles; the deployer renounces.

## Why

It extends the fixed selector set rather than creating a second authority, and keeps the pause
with servicing, where ADR 0025 puts routine controls.

## Consequences

- The controller changes, and it is in the frozen instruments' surface: listed with this reason in the diff put to review (ADR 0026).
- **Not included, taken during the build: force-closing a liquidity position.** The periphery lets the adapter's owner unwind a position, cascading the proceeds to the provider, then to the owner. With the controller as owner, proceeds the provider cannot receive would sit with the controller as a claim no act can move. With a sole provider the act is not needed, and the pause covers an emergency.
- Registering or unregistering assets and the liquidity restriction on the checker are fixed after the ceremony.
