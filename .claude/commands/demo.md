---
description: "Bring up the local stack on this machine: chain, venue, and the tests that show its controls bind."
argument-hint: "[reset|test|build|stop]"
allowed-tools: Bash, Read, Edit, Glob, Grep
---

# Bring up the local stack

Start a local chain, deploy the stack onto it, and show that the venue's controls bind.
Everything runs on a local node: no test network, no faucet, no account to create.

`$ARGUMENTS` selects the mode. Empty means `up`.

| Mode | Do this |
|---|---|
| *(empty)* / `up` | Steps 1 to 5. Skip any step already satisfied. |
| `reset` | Step 3 with a clean rebuild (`forge clean` first), then step 4. |
| `test` | Ensure the chain is up (step 3), then step 4. |
| `build` | Step 5 only. |
| `stop` | `pkill -f "anvil --chain-id 31337"` and report. Do nothing else. |

Report progress in one line per step. Do not paste build or deploy output unless a step fails.

## 1. Prerequisites

Check each and install only what is missing. Ask before installing anything.

- **Foundry**: `forge --version`. If absent:
  `curl -L https://foundry.paradigm.xyz | bash && ~/.foundry/bin/foundryup`.
  The ops scripts add `$HOME/.foundry/bin` to `PATH` themselves; your own calls need it too.
- **Node 20 or later**, for the chain library tests in `site/`: `node --version`.

## 2. Submodules

```bash
git submodule update --init --recursive
```

Nothing compiles without them. `ops/build.sh` names the first one missing.

## 3. Chain and stack

```bash
./ops/reset.sh
```

Starts the local chain (chain 31337, standard EIP-170 limit enforced) and runs the deploy
sequence in `ops/README.md`. The first run spends a few minutes compiling: the venue unit uses
the IR pipeline at a very high optimizer-run count, which the core pool library needs.
`ops/addresses.json` is written here and read by everything after.

## 4. The controls bind

```bash
forge test --fork-url http://127.0.0.1:8545 -vv
( cd site && npm install && MANIFEST_PATH=../ops/addresses.json npm run test:chain )
```

The Foundry tests are the venue's controls, each shown succeeding or failing for the right
reason; the README maps each to its control. The chain library test decodes the deployment's
whole history and fails if any call is unrecognised by the audit tape.

## 5. Both compilation units

```bash
./ops/build.sh
```

Builds the venue and instruments units and fails if any deployable contract exceeds EIP-170,
if a submodule is missing, or if the debt standard is not at its recorded pin.

## Troubleshooting

- **A deploy fails on code size.** Something has imported the position manager into a
  default-profile file, or the build cache is stale after a change to the restrictions. Run
  `forge clean` and rebuild.
- **A local node already running from something else.** The ops scripts only stop processes
  matching `anvil --chain-id 31337`, so an unrelated node on port 8545 will collide.
