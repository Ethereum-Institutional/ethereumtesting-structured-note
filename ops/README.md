# ops

| File | Purpose |
|---|---|
| `reset.sh` | Fresh local chain, then the whole stack. Start here. |
| `deploy-stack.sh` | The whole stack onto a chain that is already running. |
| `build.sh` | Builds both compilation units and fails if any deployable contract exceeds EIP-170. |
| `anvil.sh` | Starts the local chain. The standard EIP-170 limit is enforced. |
| `setup-permit2.sh` | Installs canonical Permit2 bytecode at its canonical address. |
| `keys.env` | Local node default accounts, mapped to capacities. `source` it. |
| `addresses.json` | Every deployed address. Written by the deploy scripts, read by the tests. Not committed. |

## Deploy sequence

This is the one place the sequence is written down. `deploy-stack.sh` is the authority; if the
two disagree, the script is right and this table is to be corrected.

| Step | Script | Why it comes here |
|---|---|---|
| Permit2 | `setup-permit2.sh` | The router and position manager take it as a constructor argument |
| Stand-ins | `script/00_DeployStandIns.s.sol` | The venue wraps an asset that must already exist. Starts the manifest |
| Venue | `script/01_DeployVenue.s.sol` | Creates the adapter, which the Issuer then onboards as a holder |
| Activation | `script/02_ActivateVenue.s.sol` | Verification needs the adapter to hold a balance. Opens and seeds the pool |
| Lens | `script/03_DeployLens.s.sol` | Reads pool state; needs the pool manager |
| Custody | `script/04_DeployCustody.s.sol` | Client accounts approve the router and position manager, so they come last |

On the public test network the core pool manager and Permit2 are already deployed: pass
`POOL_MANAGER` to the venue script, and skip `setup-permit2.sh`.

## Why Permit2 is installed by RPC

Permit2 pins `solidity 0.8.17` while the venue unit is `0.8.26`, so it cannot be compiled in
the tree. The periphery's own tests etch precompiled bytecode; `setup-permit2.sh` does the
same over `anvil_setCode`, so the local node carries Permit2 at its canonical address.
