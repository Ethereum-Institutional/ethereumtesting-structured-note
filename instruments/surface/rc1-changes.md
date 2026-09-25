# Changes to the instruments' surface since `instruments-surface-rc1`

ADR 0026: any change to a surface file after the release candidate is listed here, with its reason,
for the diff put to review before the final freeze. `python3 ops/surface.py check
instruments/surface/rc1.json` reports exactly these.

| File | Runtime code | Change | Reason |
|---|---|---|---|
| `src/TokenizedDeposit.sol` | Unchanged | Comments only: the NatSpec no longer describes the deposit as simulated or valueless, or the gateway as a stand-in. | ADR 0027: what is written on-chain, verified source included, reads as production. The disclosure stays in the overview and the evidence pack. |
| `src/GovernanceController.sol` | Changed: 13,199 to 16,815 bytes | Typed venue acts: `setVenueSwapping` (servicing wallet), `withdrawPoolAccess` (Tier 1), `acceptVenueOwnership`, and Tier 2 proposals to repoint the credential gate, approve a liquidity provider, allow a router or hook on the adapter, and appoint a pool attester. The constructor takes the venue's checker, adapter and credential gate, all or none. | ADR 0039: the venue is governed through the controller's fixed, typed act set. No existing act changed; the existing tests pass unchanged apart from the constructor's new arguments. |

Deploy and test code changed too (`script/`, `test/`), and is outside the surface.
