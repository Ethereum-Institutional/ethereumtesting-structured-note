# Spike 1. Contract size under EIP-170

Status: complete, 23 September 2026. Outcome: **the venue passes; the instrument passes only
with two changes to the plan**, set out under Consequences.

The question was whether per-path compiler restrictions bring every contract under the
24,576-byte runtime limit, for the conversion facility and for the instruments. They do for
the facility. They do not for the instruments, which fit by a different route.

---

## 1. Conversion facility

### Result

| Contract | Before | After | Spare |
|---|---|---|---|
| Permissioned position manager | 31,983 | 23,195 | 1,381 |
| Pool manager (reused on the test network) | 24,009 | 24,009 | 567 |
| Compliance hook | 6,665 | 6,665 | |
| Router | 11,328 | 11,328 | |

All figures are runtime bytes. The full stack deploys on a local node that enforces the
standard limit, and all 13 integration tests pass against it. The node was confirmed to
enforce the limit by deploying 24,576 bytes of runtime code, which succeeds, and 24,577,
which is rejected.

### Mechanism

`foundry.toml` compiles the position manager and its base at 500 optimizer runs through
`compilation_restrictions`, as the upstream repository does. Every other file stays on the
default profile.

The previous attempt failed for a reason that was not recorded. The core pool library does
not compile at low runs (stack too deep in the swap routine). A restriction applies to the
whole compilation unit of any file that imports the restricted one, and the deploy script
imported both the pool manager and the position manager, so the pool library was pulled into
the low-runs unit.

The fix is that no file imports both. The deploy script deploys the pool manager and the
position manager from their compiled artifacts (`deployCode`), and two one-line files under
`script/artifacts/` exist only so that those artifacts are built. On the test network the pool
manager is not deployed at all: the script takes the canonical deployment as `POOL_MANAGER`.

Deploying the position manager from its artifact matters for a second reason. While the
script imported it, the script joined the low-runs unit and took the hook and the router with
it, so the bytecode deployed for them was a 500-runs build rather than the default one. Two
builds of an audited contract, with the deployed one not the default, is exactly the ambiguity
an audit must not inherit. Each contract now has exactly one build.

### Gotchas recorded

- **Clear the build cache after changing the restrictions.** An incremental build after the
  change reported sizes from a mixed cache (the hook and router at their low-runs sizes against
  default-profile metadata). `forge clean` resolved it. Treat any size reading taken after a
  restriction change without a clean build as unreliable.
- **Nothing may import the position manager.** Any file that does joins the low-runs unit.
  The comments in `script/artifacts/` and `foundry.toml` say so.
- The raised code-size limit has been removed from every node start (`ops/anvil.sh`,
  `ops/bake-state.sh`, `ops/serve-local.sh`, the hosted node image) and
  `--disable-code-size-limit` from the deploy scripts.

**The conversion facility is not gated by contract size.** Wave 5 stands.

---

## 2. Instruments

### Result

The debt standard, pinned at its release candidate, was compiled in isolation against its own
library version. No shipped deployment variant contains everything the note needs. Upgradeable
variants are separate for snapshots, holder enumeration and native UUPS, and several sit within
a few hundred bytes of the limit, as the standard's own authors note.

The note needs, in one contract: native UUPS (the upgrade role is what the Tier 2 ceremony
holds), enforcement carrying a written reason payload, the snapshot hook, holder enumeration,
document anchoring and an external validation hook for the eligibility checker. The table
composes those onto the standard's bases.

Runtime bytes, most favourable settings (legacy pipeline, 200 runs):

| Composition | Bytes | Against limit |
|---|---|---|
| Standard base with UUPS and reason-carrying enforcement | 25,145 | over by 569 |
| as above, with snapshot hook | 25,850 | over by 1,274 |
| as above, with holder enumeration | 26,817 | over by 2,241 |
| as above, with both | 26,957 | over by 2,381 |
| **Lean base, everything the note needs** | **23,809** | 767 spare |
| **Lean base, with reentrancy guard on the validation callback** | **24,004** | **572 spare** |
| Lean base, guarded, with the debt attributes module | 28,574 | over by 3,998 |

The standard bases carry a cross-chain transfer module and a gasless-transaction forwarder
module. The note needs neither. The **lean base** composes from the standard's lower,
rule-engine layer and adds the reason-carrying enforcement module, snapshot hook, holder
enumeration and UUPS directly, omitting both. The call chain was checked: the holder
enumeration update calls through to the snapshot hook, which calls the base token, so no
module's code is missing from the measurement.

No compiler setting closes the gap on the standard bases. At runs=1 on the legacy pipeline
the full composition is still 1,365 bytes over. The IR pipeline is worse at every setting.

### This repository's compiler cannot build the instrument

| Lean base, guarded | Bytes |
|---|---|
| Legacy pipeline, 200 runs, solc 0.8.34 | 24,004 |
| IR pipeline, 200 runs, solc 0.8.26 | 26,737 |
| IR pipeline, 1 run, solc 0.8.26 | 26,155 |

The venue's compilation unit is pinned to solc 0.8.26 on the IR pipeline, which the core pool
library requires. At 0.8.26 the standard compiles only via IR (its use of `require` with a
custom error needs 0.8.27 or later on the legacy pipeline), and via IR it does not fit.

This supersedes one line of HANDOFF §3. "Solc is not a barrier" holds for compilation. **It
does not hold for size.** The instrument must be built on the legacy pipeline with solc 0.8.27
or later, which a per-path restriction inside the venue's unit cannot provide, because the unit
pins one compiler version.

Measured across 0.8.27, 0.8.30, 0.8.34 and 0.8.36 on the legacy pipeline, sizes vary by at most
six bytes, so the choice of version within that range is not a sizing question.

---

## 3. Consequences

1. **Instruments build in their own compilation unit.** A separate project beside the venue,
   on the legacy pipeline, solc pinned at or above 0.8.27, with the standard's own library
   version. This mirrors the existing issuer stack, which already builds separately, and
   removes the library version conflict noted in HANDOFF §3 rather than configuring around it.
   The two units interact only over ABI, which is already the architecture: the note never
   touches the pool, and the checker interface floats its pragma so one checker serves both.
2. **The note is a custom composition on the standard's modules, not a shipped variant.** The
   modules remain inherited code. The composing contract, its override resolution and its
   initialiser are written here and **sit in audit scope**. Declare this to the audit firm
   alongside the release candidate pin.
3. **The debt attributes module does not fit.** Instrument terms stay in the off-chain
   register (D7) and the anchored documents, or move to an external engine under the pattern the
   standard already uses for snapshots. Nothing in the client's draft requires them on-chain.
4. **The margin is 572 bytes.** Any logic added to the token itself spends it. Spike 2 should
   assume the compliance-interface adapter surface lives outside the token unless the standard
   already provides a function, and should measure any addition against this figure.
5. **One sentence in the solution overview wants a caveat.** It says snapshots, document
   anchoring, holder enumeration, enforcement and upgradeability are inherited as audited code
   rather than written. The modules are; the composition is not. The overview is signed off and
   has not been edited.

The deposit token was not measured. It carries far less than the note and is not expected to
approach the limit, but should be checked when it is composed.

## 4. Reproduction

Venue: `forge clean && forge build --sizes`, then `./ops/reset.sh` and
`forge test --fork-url http://127.0.0.1:8545`.

Instrument: clone the standard at its release candidate, install its declared library version,
add the compositions above as contracts, and build with
`FOUNDRY_SOLC_VERSION=0.8.34 FOUNDRY_VIA_IR=false FOUNDRY_OPTIMIZER_RUNS=200 FOUNDRY_EVM_VERSION=cancun forge build --sizes`.
The composition sources were kept outside this repository because they carry the standard's
identifiers; they become Wave 2 code once the dependency is added.
