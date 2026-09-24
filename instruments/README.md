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

| Path | Holds |
|---|---|
| `src/interfaces/IEligibilityGate.sol` | The per-instrument gate: a rule engine that also answers account-level eligibility (spike 2) |

```bash
forge build --sizes
```
