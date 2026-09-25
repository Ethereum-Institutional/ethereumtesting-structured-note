# ops

| File | Purpose |
|---|---|
| `reset.sh` | Fresh local chain, then the whole stack. Start here. |
| `deploy-stack.sh` | The whole stack onto a chain that is already running. |
| `build.sh` | Builds both compilation units and fails if any deployable contract exceeds EIP-170. |
| `anvil.sh` | Starts the local chain. The standard EIP-170 limit is enforced. |
| `setup-permit2.sh` | Installs canonical Permit2 bytecode at its canonical address. |
| `setup-credential-protocol.sh` | Installs the credential protocol's released registry code at its canonical addresses, refusing any file whose hash has changed (ADR 0040). |
| `dry-run-fork.sh` | Forks the test network, deploys the whole stack against its real contracts, and runs the venue tests (ADR 0041). |
| `networks/` | Each public network's identifiers. Only the template is committed (ADR 0029). |
| `setup-multisig.sh` | Installs the multi-signature wallet's released code at its canonical addresses, refusing any file whose hash has changed (ADR 0024). |
| `keys.env` | Local node default accounts, mapped to capacities. `source` it. |
| `addresses.json` | Every deployed address. Written by the deploy scripts, read by the tests. Not committed. |

## Deploy sequence

This is the one place the sequence is written down. `deploy-stack.sh` is the authority; if the
two disagree, the script is right and this table is to be corrected.

| Step | Script | Why it comes here |
|---|---|---|
| Permit2, wallets, credential protocol | `setup-permit2.sh`, `setup-multisig.sh`, `setup-credential-protocol.sh` | The router and position manager take Permit2 as a constructor argument; the ceremony creates wallets from the canonical factory; the protocol's registries embed their own addresses (ADR 0040) |
| Base | `script/00_DeployBase.s.sol` | The payment token and the protocol's registries, which everything else refers to. Starts the manifest |
| Instruments | `instruments/script/DeployInstruments.s.sol` | The venue wraps the deposit, so the deposit must exist first. Extends the manifest |
| Venue | `script/01_DeployVenue.s.sol` | Creates the adapter around the deposit and the pool's credential gate; onboards the adapter and Permit2 to the registry |
| Activation | `script/02_ActivateVenue.s.sol` | Verification needs the adapter to hold a balance. Opens the pool at par, admits the cast, and the Deposit Agent provides liquidity |
| Lens | `script/03_DeployLens.s.sol` | Reads pool state; needs the pool manager |
| Custody | `script/04_DeployCustody.s.sol` | Client accounts approve the router and position manager, and are onboarded and admitted |
| Issuance | `instruments/script/IssueNote.s.sol` | Fixes illustrative terms, dated from the chain's own clock; attaches the lifecycle; places units by DvP |
| Ceremony | `instruments/script/Ceremony.s.sol` | Creates the four wallets, deploys the controller, moves every role and hands the venue over, and ends with the deployer's renunciation, so it must come last |

On a public network nothing is installed and nothing is deployed in the base step: the pool
manager, Permit2, the wallet, the payment token and the protocol's registries are already there,
and their addresses come from the network file (`ops/networks/`, ADR 0029). `dry-run-fork.sh` runs
the whole sequence against a fork of the test network (ADR 0041).

## Why Permit2 is installed by RPC

Permit2 pins `solidity 0.8.17` while the venue unit is `0.8.26`, so it cannot be compiled in
the tree. The periphery's own tests etch precompiled bytecode; `setup-permit2.sh` does the
same over `anvil_setCode`, so the local node carries Permit2 at its canonical address.
