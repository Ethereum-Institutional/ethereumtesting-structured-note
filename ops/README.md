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
| `new-network-keys.sh` | Generates a fresh key set for a public network, never the local node's published keys (ADR 0051). |
| `deploy-network.sh` | Deploys the whole stack to a live network with those keys, after checking every capacity is funded (ADR 0051). |
| `networks/` | Each public network's identifiers. Only the template is committed (ADR 0029). |
| `setup-multisig.sh` | Installs the multi-signature wallet's released code at its canonical addresses, refusing any file whose hash has changed (ADR 0024). |
| `keys.env` | Local node default accounts, mapped to capacities. `source` it. |
| `addresses.json` | Every deployed address. Written by the deploy scripts, read by the tests. Not committed. |

## Deploy sequence

This is the one place the sequence is written down. `deploy-stack.sh` is the authority; if the
two disagree, the script is right and this table is to be corrected.

| Step | Script | Why it comes here |
|---|---|---|
| Permit2, wallets | `setup-permit2.sh`, `setup-multisig.sh` | The router and position manager take Permit2 as a constructor argument; the ceremony creates wallets from the canonical factory |
| Base | `script/00_DeployBase.s.sol` | The parties and the payment token, which everything else refers to. Starts the manifest |
| Instruments | `instruments/script/DeployInstruments.s.sol` | The venue wraps the deposit, so the deposit must exist first. Extends the manifest |
| Venue | `script/01_DeployVenue.s.sol` | Creates the adapter around the deposit and the pool's gate on the pool's identity registry; the bank allowlists the adapter and Permit2 on the deposit. Deployed by default; `POOL=0` leaves the pool out (ADR 0090) |
| Activation | `script/02_ActivateVenue.s.sol` | Verification needs the adapter to hold a balance. Opens the pool at par, the onboarding agent admits the cast by pool-access claim, and the Deposit Agent provides liquidity |
| Lens | `script/03_DeployLens.s.sol` | Reads pool state; needs the pool manager |
| Custody | `script/04_DeployCustody.s.sol` | Client accounts approve the router and position manager, and are onboarded and admitted |
| Issuance | `instruments/script/IssueNote.s.sol` | Issues the note through the note factory in one transaction (ADR 0091), its terms dated from the chain's own clock; the bank allowlists its lifecycle and funds the Agent; places units by DvP |
| Ceremony | `instruments/script/Ceremony.s.sol` | Creates the four wallets, deploys the controller, moves every role and hands the venue over, and ends with the deployer's renunciation, so it must come last |

On a public network nothing is installed and nothing is deployed in the base step: the pool
manager, Permit2, the wallet, the payment token and the protocol's registries are already there,
and their addresses come from the network file (`ops/networks/`, ADR 0029). `dry-run-fork.sh` runs
the whole sequence against a fork of the test network (ADR 0041).

## Why Permit2 is installed by RPC

Permit2 pins `solidity 0.8.17` while the venue unit is `0.8.26`, so it cannot be compiled in
the tree. The periphery's own tests etch precompiled bytecode; `setup-permit2.sh` does the
same over `anvil_setCode`, so the local node carries Permit2 at its canonical address.
