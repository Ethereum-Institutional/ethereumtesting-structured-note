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
| `src/IdentityRegistry.sol` | The whitelist of record: rights and attribute flags, jurisdiction and expiry per address, written by a registrar's issuing key, one storage read per check | 3,736 |
| `src/InstrumentGate.sol` | One instrument's test against the registry: required send and receive masks, optional permitted jurisdictions. Immutable. Meets spike 2's G1 and G2 | 1,527 |
| `src/base/AdaptedToken.sol` | The lean composition with spike 2's six adaptations, shared by both tokens | |
| `src/StructuredNote.sol` | The note: decimals zero, snapshots, holder list, term sheet anchored by hash | 24,382 (194 spare) |
| `src/TokenizedDeposit.sol` | The cash leg: decimals two, mint and burn held only by the gateway | 22,135 |
| `src/interfaces/IDepositGateway.sol`, `src/DepositGateway.sol` | What a deposit service must expose to settle on a public network: credit and debit, each against a single-use booking reference | 1,877 |

`script/Instruments.sol` is the deployment, used by both `script/DeployInstruments.s.sol` and the
integration tests, so the tests exercise exactly what is deployed. Roles are held by capacities
until Wave 4 moves them to the controller and the Agent's multi-signature; no one holds the
upgrade role. Names and symbols are provisional, pending naming sign-off.

```bash
forge build --sizes
forge test          # 65: conformance on both tokens, registry, gate, and the deployed wiring
```
