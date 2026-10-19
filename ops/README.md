# ops

| File | Purpose |
|---|---|
| `reset.sh` | Fresh local chain, then the whole stack. Start here. |
| `deploy-stack.sh` | The whole stack onto a chain that is already running. |
| `build.sh` | Builds both compilation units and fails if any deployable contract exceeds EIP-170. |
| `anvil.sh` | Starts the local chain. The standard EIP-170 limit is enforced. |
| `setup-permit2.sh` | Installs canonical Permit2 bytecode at its canonical address. |
| `dry-run-fork.sh` | Forks the test network, deploys the whole stack against its real contracts, and runs the venue tests. |
| `new-network-keys.sh` | Generates a fresh key set for a public network, never the local node's published keys. |
| `deploy-network.sh` | Deploys the whole stack to a live network with those keys, after checking every capacity is funded. |
| `networks/` | Each public network's identifiers. Only the template is committed. |
| `setup-multisig.sh` | Installs the multi-signature wallet's released code at its canonical addresses, refusing any file whose hash has changed. |
| `sepolia.sh` | Short commands for the Ethereum Sepolia deployment: `check` (balances only), `deploy`, `verify`, `site-env`. |
| `verify-contracts.py` | Verifies every deployed contract on Etherscan, linked libraries included; clones and deployment stubs are recognised as such. |
| `vercel-env.sh`, `site_env.py` | Point the site's Vercel project at a deployment: the manifest, the RPC, the signing keys and a fresh `CRON_SECRET`, sent straight to Vercel. |
| `store-secret.sh` | Stores a secret in a key file without it passing through a terminal. |
| `surface.py` | Records a release candidate's contract surface, and checks a tree against it. |
| `vm/` | The site and its database as containers, for running on the bank's own machine. |
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
| Venue | `script/01_DeployVenue.s.sol` | Creates the adapter around the deposit and the pool's gate on the pool's identity registry; the bank allowlists the adapter and Permit2 on the deposit. Deployed by default; `POOL=0` leaves the pool out |
| Activation | `script/02_ActivateVenue.s.sol` | Verification needs the adapter to hold a balance. Opens the pool at par, the onboarding agent admits the cast by pool-access claim, and the Deposit Agent provides liquidity |
| Lens | `script/03_DeployLens.s.sol` | Reads pool state; needs the pool manager |
| Custody | `script/04_DeployCustody.s.sol` | Client accounts approve the router and position manager, and are onboarded and admitted |
| Programme | `instruments/script/DeployProgramme.s.sol` | Creates the four institutions' wallets, then the sanctions module, the governance controller and the note factory, owned by the Issuer's wallet; the controller is bound to the factory, and T-REX's factory handed to it |
| Term sheet | `site/scripts/term-sheet.ts` | The record the deployment's note is issued from, dated from the chain's own clock |
| Issuance | `instruments/script/IssueNote.s.sol` | The Issuer's wallet issues the note through the factory in one transaction, which allowlists its lifecycle on the deposit and hands it to the controller; the bank funds the Agent; units are placed by locked offer |
| Ceremony | `instruments/script/Ceremony.s.sol` | Hands the pool's registries and venue to the controller and ends with the deployer's renunciation of the deposit and gateway, so it must come last |

On a public network nothing is installed and nothing is deployed in the base step: the pool
manager, Permit2, the wallet and the payment token are already there,
and their addresses come from the network file (`ops/networks/`). `dry-run-fork.sh` runs
the whole sequence against a fork of the test network.

## Why Permit2 is installed by RPC

Permit2 pins `solidity 0.8.17` while the venue unit is `0.8.26`, so it cannot be compiled in
the tree. The periphery's own tests etch precompiled bytecode; `setup-permit2.sh` does the
same over `anvil_setCode`, so the local node carries Permit2 at its canonical address.
