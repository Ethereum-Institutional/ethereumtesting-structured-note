---
description: Bring up the whole demo on this machine — local chain, full stack, console on :3010.
argument-hint: "[reset|test|stop]"
allowed-tools: Bash, Read, Edit, Glob, Grep
---

# Run the APAC permissioned-RWA demo

Bring this demo up on the user's machine and hand them a working URL. Everything runs on a
local Anvil node — no testnet, no faucets, no accounts to create, no network dependency.

`$ARGUMENTS` selects the mode. Empty means `up`.

| Mode | Do this |
|---|---|
| *(empty)* / `up` | Full walkthrough below. Skip any step already satisfied. |
| `reset` | Skip to step 4 with a forced clean rebuild (`./ops/reset.sh`), then step 6. |
| `test` | Ensure the chain is up (steps 4–5), then run the test suite in step 7. |
| `stop` | `pkill -f "anvil --chain-id 31337"`, stop the dev server, and report. Do nothing else. |

Report progress in one line per step. Do not paste build or deploy output unless a step fails.
The whole thing takes ~5 minutes on a cold clone, most of it Solidity compilation.

## 1. Prerequisites

Check each and only install what's missing. Ask before installing anything.

- **Foundry** — `forge --version`. If absent:
  `curl -L https://foundry.paradigm.xyz | bash && ~/.foundry/bin/foundryup`
  Add `$HOME/.foundry/bin` to `PATH` for every later step; the ops scripts do this themselves
  but your own `forge`/`cast`/`anvil` calls need it too.
- **Node 20+** — `node --version`. Install via the user's package manager if absent.

Not needed, despite what the stack suggests: no Docker, no database, no mail provider, no
testnet funds, no cloud account. Python 3 is used only by the hosting scripts
(`ops/deploy-chain.sh`, `ops/serve-local.sh`), not by anything on the local path.

## 2. Submodules

```bash
git submodule update --init --recursive
```

Three of them (`v4-periphery`, `uniswap-hooks`, `forge-std`), and `v4-periphery` pulls its own
nested tree. A missing submodule shows up as a confusing "file not found" during compilation,
so confirm `lib/v4-periphery/lib/v4-core` exists before moving on.

## 3. Node dependencies

Both are required — `ops/reset.sh` does **not** install them for you.

```bash
( cd trex && npm install )
( cd dashboard && npm install )
```

## 4. Build and deploy the stack

```bash
./ops/reset.sh
```

This starts Anvil (chain 31337, standard EIP-170 limit enforced) and runs the eight deploy phases in
dependency order — Permit2, the T-REX issuer stack under Hardhat, the Uniswap v4 venue under
Foundry, adapter allow-listing, pool activation, then custody. See `ops/README.md`.

Expect the **first** run to spend several minutes in `forge build` before anything is deployed.
That is normal: `foundry.toml` uses `via_ir = true` with `optimizer_runs = 44444444`, which
v4-core's `Pool` library requires. Subsequent runs are cached and take about a minute.

Two things worth knowing if it fails:

- If a *fast* path is wanted and `ops/anvil-state.json` exists, you can skip this whole step —
  see "Shortcut" below.
- `ops/addresses.json` is generated here, not committed. Every later step reads it.

## 5. Confirm the chain is real

```bash
cast block-number --rpc-url http://127.0.0.1:8545
```

Then read `ops/addresses.json`, take `.trex.token`, and check the asset actually exists:

```bash
cast call <token address> 'totalSupply()(uint256)' --rpc-url http://127.0.0.1:8545
```

A non-zero total supply means the issuer stack deployed and minted. Zero or an error means
step 4 did not finish, whatever it printed.

## 6. Start the console

```bash
( cd dashboard && npm run dev )
```

Run it in the background and tell the user: **http://localhost:3010**

Then explain how to get in, because it is not guessable:

- The investor portal is open at `/`.
- Sign-in is a magic link, and there is deliberately **no mail provider** — the link is printed
  on screen (`dashboard/lib/auth.ts`). Nothing to configure.
- The compliance-officer view needs a staff code. If `dashboard/.env.local` is missing, create
  it with a code of the user's choosing, then use it at `/login` → "I am compliance staff":

  ```
  STAFF_ACCESS_CODE=<anything>
  ADMIN_EMAILS=<the user's email>
  ```

- Storage falls back to a JSON file when no `POSTGRES_URL`/`DATABASE_URL` is set, so the portal
  is fully usable with no database. The UI labels the driver so nobody mistakes it for durable.
- Signing uses Anvil's public test keys unless `DEMO_KEYS` overrides them.

## 7. Prove the compliance gates actually bind

```bash
forge test --fork-url http://127.0.0.1:8545 -vv
```

13 tests across `test/PermissionedTrading.t.sol` and `test/CustodyTrading.t.sol`. They are the
real substance of the demo — a frozen investor's swap reverting, a non-professional investor
blocked from providing liquidity, one custody client frozen without touching its siblings.
The README's "Demo beats" section maps each test to the story it tells.

## Shortcut: the baked snapshot

If `ops/anvil-state.json` is present, the entire toolchain is unnecessary — the snapshot is a
fully-deployed chain, and `anvil` alone can serve it:

```bash
anvil --chain-id 31337 --load-state ops/anvil-state.json
```

Skip steps 2, 3 and 4 entirely; you still need `dashboard/npm install` for step 6. Contract
addresses are deterministic, so the committed expectations still match.

The file is gitignored, so a fresh clone will not have it. `./ops/bake-state.sh` regenerates
it, but that needs the full toolchain — so on a cold clone, take the long path above.

## Troubleshooting

- **"Not connected to a chain" in the console.** Anvil is not running, or `RPC_URL` in the
  environment points somewhere else. Locally it should be unset (defaults to
  `http://127.0.0.1:8545`) — check `dashboard/.env.local` for a leftover hosted value.
- **Port 3010 in use.** `npm run dev` pins the port; free it or change it in
  `dashboard/package.json`.
- **A deploy fails on code size.** The position manager is compiled at low optimizer runs by
  a per-path restriction in `foundry.toml` and deployed from its artifact. If it has grown
  past 24,576 bytes, something has imported it into a default-profile unit, or the build
  cache is stale after a change to the restrictions. Run `forge clean` and rebuild.
- **Anvil already running from something else.** The ops scripts only kill processes matching
  `anvil --chain-id 31337`, so an unrelated node on 8545 will collide. Stop it first.
