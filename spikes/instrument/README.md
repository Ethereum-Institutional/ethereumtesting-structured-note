# Instrument spike harness

Evidence for spikes 1 and 2 (`docs/spikes/`). Not Wave 2 code, though Wave 2 starts from
`src/H_Adapted.sol`.

A separate Foundry project because the instrument cannot share the venue's compilation unit:
it fits under EIP-170 only on the legacy pipeline at solc 0.8.27 or later. It builds against the
debt standard pinned in `instruments/lib/`, at its release candidate.

```
git submodule update --init --recursive
cd spikes/instrument
forge build --sizes --skip test   # the size tables in docs/spikes/01 and 02
forge test                        # 4 defect tests on the unadapted build, 13 conformance tests
```

| File | Composition |
|---|---|
| `A_Full.sol` to `D_Min.sol` | On the standard bases. None fits |
| `E_Lean.sol` | Lean base from the rule-engine layer |
| `F_Guarded.sol` | Lean, with the reentrancy guard on the rule-engine callback. Spike 1 result |
| `G_Debt.sol` | As F, with the debt attributes module. Does not fit |
| `H_Adapted.sol` | As F, with the ERC-7943 adaptations. Spike 2 result |
| `IEligibilityGate.sol` | The per-instrument gate interface the adaptations assume |

Figures include the metadata hash. Setting `bytecode_hash = "none"` saves 41 bytes per contract.
