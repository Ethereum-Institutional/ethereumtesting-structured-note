# Instruments

The compilation unit for the note and the tokenized deposit. Wave 2 builds them here, starting
from the adapted composition in `spikes/instrument/src/H_Adapted.sol`.

Separate from the venue's unit by necessity (spike 1): the note fits under EIP-170 only on the
legacy pipeline at solc 0.8.27 or later, and the venue is pinned to 0.8.26 on the IR pipeline.
The two meet only over ABI.

The debt standard is a submodule at `lib/debt-standard`, pinned at its **release candidate**,
because snapshots, the holder list and full enforcement exist only there. `ops/build.sh`
refuses to build at any other pin. Re-pinning to the final release is a gate before anything
moves past PoC; see HANDOFF.md section 3.

| Contract | Is | Size (bytes) |
|---|---|---|
| `src/IdentityRegistry.sol` | The whitelist of record: rights and attribute flags, jurisdiction and expiry per address, written by a registrar's issuing key, one storage read per check | 4,283 |
| `src/InstrumentGate.sol` | One instrument's test against the registry: required send and receive masks, optional permitted jurisdictions, and a settlement mask for infrastructure spenders (ADR 0013). Immutable. Meets spike 2's G1 and G2 | 1,688 |
| `src/base/AdaptedToken.sol` | The lean composition with spike 2's six adaptations, shared by both tokens | |
| `src/StructuredNote.sol` | The note: decimals zero, snapshots, holder list, term sheet anchored by hash | 24,382 (194 spare) |
| `src/TokenizedDeposit.sol` | The cash leg: decimals two, mint and burn held only by the gateway | 22,135 |
| `src/interfaces/IDepositGateway.sol`, `src/DepositGateway.sol` | What a deposit service must expose to settle on a public network: credit and debit, each against a single-use booking reference | 1,877 |
| `src/DeterminationAgent.sol` | The terms and calendar, fixed at issuance; accepts a signed determination only when its own computation agrees (spike 3, D1) | 8,032 |
| `src/RecordDateEngine.sol` | The note's snapshot engine: balances at any past instant (E1), and the transfer stop at a possible redemption (E4) | 1,832 |
| `src/PayingAgent.sol` | Coupons and redemptions to holders of record, reconciled on-chain; amounts the deposit cannot credit are held and claimable; coupon reversal and restatement for the controller (ADR 0014) | 10,710 |
| `src/DvPSettlement.sol` | Delivery versus payment: propose, then accept, both legs or neither | 2,956 |
| `src/GovernanceController.sol` | Every privileged power, in two tiers, through typed acts only: Tier 1 by the Agent's governance wallet; Tier 2 by two of three institutions and four signatures, after a delay; recovery with veto; the conversion venue's typed acts (ADRs 0019, 0021 to 0025, 0039) | 16,815 |

`script/Instruments.sol` is the deployment, `script/Lifecycle.sol` the issuance and
`script/Governance.sol` the ceremony, each used by its script (`DeployInstruments.s.sol`,
`IssueNote.s.sol`, `Ceremony.s.sol`) and by the tests, so the tests exercise exactly what is
deployed. After the ceremony the deployer holds nothing. Roles are held by capacities
until Wave 4 moves them to the controller and the Agent's multi-signature. Upgrade, forced
transfer and supervisory withdrawal are held by no one until then. Names, symbols and the term
sheet are deploy parameters (HANDOFF.md, W6), provisional pending sign-off.

```bash
forge build --sizes
forge test --force  # 115, including all 25 payoff scenarios end to end
FOUNDRY_PROFILE=fork forge test --fork-url http://127.0.0.1:8545   # governance through the real wallets
python3 test/vectors/flatten.py   # after regenerating spikes/payoff/vectors.json
```

Use `--force` after changing a contract. Forge's incremental build can leave a test running
against stale creation code for a contract it deploys, so a changed contract appears to pass.

## Contract surface

The surface under assurance review is defined by `surface/rc1.json`: every source in `src/`, each
deployable contract's runtime code, the compiler settings and the debt standard's pin, all by
SHA-256. It is tagged `instruments-surface-rc1` (ADR 0026).

```bash
python3 ops/surface.py check instruments/surface/rc1.json   # from the repository root
```

A change to any file in the surface before the final freeze is listed, with its reason, in the
diff put to review.
