# 0098. Ethereum Sepolia under Amsterdam, and the site as a container for the bank's VM

- **Status:** Accepted, as workstream 10 of 0.2.0
- **Date:** 15 October 2026

## Context

Plan 0.2.0, decision 4, moves everything to Ethereum Sepolia in two deployments, ours and the
bank's. Each is a complete stack with its own keys, and both are built from one codebase.
Workstream 10 asks for four things:
- a fresh Ethereum Sepolia deployment;
- a container image of the site for the bank's virtual machine, with mocks for anything it cannot reach;
- an IT hand-over guide;
- an AI build brief.

**What preparing it found:**
- **Missing key.** The key and deploy scripts (`new-network-keys.sh`, `deploy-network.sh`) predated the third-party custodian (ADR 0089). Neither generated, checked nor funded its key.
- **Funding thresholds.** The scripts asked for a flat 0.02 ETH for the Issuer and 0.002 ETH for the others, without measuring anything.
- **Amsterdam.** Ethereum Sepolia now runs the Amsterdam upgrade (its blocks carry a block-access-list hash and a slot number), which reprices state creation. Real Sepolia estimates one of our 10 KB contracts at 15.06M gas, where forge's simulation in our configured EVM (Cancun) gives about 2.1M. A deployment run on a fork of Sepolia therefore ran out of gas on its first large contract: forge sized each transaction's limit at its own estimate times 1.3.

## Decision

**The network file.** `ops/networks/ethereum-sepolia.example.json` names the canonical contracts,
each checked on chain:
- the Uniswap v4 pool manager;
- WETH;
- Circle's EURC as the payment token, with its balance slot (9) for the fork rehearsal;
- Permit2, the Safe 1.4.1 contracts and the CREATE2 deployer, which the scripts expect at their usual addresses.

The real file, with its RPC URL, stays local and is ignored by git.

**Keys.** `new-network-keys.sh` generates the third-party custodian at mnemonic index 22, as on
the local node. `deploy-network.sh` refuses it if it is a published key, and checks its balance.

**Gas from the chain, not the simulator.** On a public network, `deploy-stack.sh` runs forge with
`--skip-simulation --slow`. Forge then estimates each transaction against the chain itself, after
the one before it has been mined. That is right under any fee schedule the chain adopts.

| Option | Why not chosen |
|---|---|
| A larger gas multiplier | Tried. At three times it still failed: the gap is not a fixed factor, since it grows with code size |
| Compiling for a newer EVM version | Solidity 0.8.30 has no Amsterdam target, and the compile target would change the bytecode we have tested |

**Funding sized from a rehearsal.** `deploy-network.sh` checks each capacity against the gas
it used on a fork of Ethereum Sepolia, plus a tenth, at three times the current gas price, with a
floor of 0.01 ETH.

| Capacity | Gas on the fork |
|---|---|
| The Issuer | 525M |
| The Deposit Agent | 55M |
| The custodian | 38M |
| The third-party custodian | 16M |
| All other capacities | small amounts |
| **The whole deployment** | **650M**, about 5.5 times the local node's 119M |

The largest single transaction (72M) deploys: Amsterdam's per-transaction cap does not bind on
state creation. At the current fee of about 0.001 gwei the deployment costs under 0.001 ETH; at
5 gwei it would cost about 3.25 ETH. `CHECK_ONLY=1` runs the key and balance checks and stops before sending anything.

**The rehearsal.** `NETWORK_FILE=ops/networks/ethereum-sepolia.json ./ops/dry-run-fork.sh`
deploys the whole sequence against a local fork of Ethereum Sepolia. That covers scaffolding,
the pool on EURC, custody, the term sheet, issuance through the factory, and the governance
ceremony. The venue tests then run against the result, and all 24 pass. Nothing is published.

**The container image.** `ops/vm/` holds three files:

| File | What it does |
|---|---|
| `Dockerfile` | Builds the site's standalone Next.js server on Node 24. `NEXT_OUTPUT=standalone` is set only for this build, so the Vercel build is unchanged |
| `compose.yaml` | Runs the site beside Postgres. The site is bound to localhost, for the bank's TLS proxy |
| `vm-env.sh` | Writes the run-time settings, owner-only and ignored by git: `site.env`, `manifest.json`, and `.env` holding a generated database password |

The image holds no keys, addresses or settings. The settings the site takes from a deployment come
from one module, `ops/site_env.py`, which `vercel-env.sh` now uses too, so the public site and the
bank's VM cannot drift apart.

The owner chose how sign-in codes reach staff on the VM.

| Option | Outcome |
|---|---|
| Resend only | **Chosen.** The VM reaches `api.resend.com` with the bank's key. Mail is therefore not mocked, and the VM's only outbound traffic is HTTPS to its RPC and to Resend |
| SMTP to the bank's relay, with a mock inbox | Not chosen |
| A mock inbox only | Not chosen |

No other dependency needs a mock. Fonts load in the visitor's browser and fall back to system fonts.

**Logs.** The Postgres client no longer logs the "already exists" notices it gave each time the
site started.

**The guides.**
- `docs/it-handover.md`, for the bank's IT team: what runs where, keys, the one-off deployment, the VM, the settings, operations and troubleshooting.
- `docs/ai-build-brief.md`, for the bank's AI-led build: the requirement, the constraints that are not negotiable, the design with references into this repository, acceptance against the nine criteria and the scenarios, the lessons the reference paid for, and what is still open.

## Consequences

**Verification so far:**
- The fork rehearsal passes end to end.
- The image was run with compose and Postgres against the local chain. A browser registered staff, confirmed with the emailed code (through a mail stand-in), and read the Keys and Deposit pages from the chain.
- The shared settings module gives the same keys as before, the derived wallet owners included.

**What the user does next.** The public Ethereum Sepolia deployment itself is the user's to run.
The keys are generated, in a local file only its owner can read. The user funds them, sets the
names from the naming sign-off, and runs
`deploy-network.sh` from the repository root. Then `vercel-env.sh` points our site at the new
manifest. The bank runs its own deployment by the hand-over guide.

**A gap in local testing.** The local node runs a pre-Amsterdam fork, so local gas figures
understate public ones by about five and a half times. Tests are unaffected, since they assert
behaviour, not gas. The site's "transactions left" figure on the Keys page assumes 300k gas per
transaction, which still holds for the site's acts: they move value rather than create contracts.
The one exception is a note issued from the site, which deploys contracts through the factory.
