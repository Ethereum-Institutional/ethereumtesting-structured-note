# APAC Permissioned RWA Demo

A working end-to-end demo of a **real ERC-3643 (T-REX) security token trading in a
permissioned Uniswap v4 pool**, with the compliance seam between the two built on
OpenZeppelin libraries.

Everything runs on a local Anvil node. No testnet, no faucets, no network dependency.

## What it demonstrates

| Layer | What it is | Source |
|---|---|---|
| Asset | `APACDC` — ERC-3643 permissioned token, ONCHAINID identity registry, modular compliance | Tokeny T-REX v4.1.6 |
| Compliance seam | `ERC3643AllowlistChecker` — translates ERC-3643 identity into Uniswap `PermissionFlag`s | **written here**, on OZ v5 |
| Hook | `PermissionedComplianceHook` — gates swaps and liquidity at the pool | **written here**, on OZ `uniswap-hooks` |
| Venue | Permissions adapter, router, position manager | Uniswap `v4-periphery` |
| Custody | Custodian operating segregated client accounts | **written here**, on OZ v5 |

The interesting contract is [`contracts/ERC3643AllowlistChecker.sol`](contracts/ERC3643AllowlistChecker.sol).
Uniswap's permissioned pools ask one question — *what may this account do with this asset?*
— and this answers it from the **issuer's identity registry** rather than a venue-held list.
Revoke a claim or freeze a wallet in T-REX and trading stops, with no venue action at all.

`v4-periphery` ships the adapter, router and position manager but **no production hook** —
the only one in the repo is a test mock. [`contracts/PermissionedComplianceHook.sol`](contracts/PermissionedComplianceHook.sol)
is that missing piece, written against OpenZeppelin's `BaseHook`.

## Quick start

```bash
./ops/reset.sh                                    # full clean deploy, ~60s
forge test --fork-url http://127.0.0.1:8545 -vv   # 13 tests: prove the gates bind
cd dashboard && npm run dev                       # custody console on :3010
```

## The cast

| Role | Wallet | Jurisdiction | Claims | May |
|---|---|---|---|---|
| Alice | anvil #3 | Singapore (702) | KYC + professional | swap **and** provide liquidity |
| Bob | anvil #4 | Hong Kong (344) | KYC only | swap only |
| Carol | anvil #5 | Japan (392) | KYC + professional | swap and LP |
| Dave | anvil #6 | — | none | nothing |
| Issuer | anvil #0 | owns token, registries, venue contracts | | |
| Agent | anvil #1 | freeze, force-transfer, mint, pause | | |

## Demo beats

13 passing tests across [`test/PermissionedTrading.t.sol`](test/PermissionedTrading.t.sol) and
[`test/CustodyTrading.t.sol`](test/CustodyTrading.t.sol):

1. **Alice trades.** 10,000 USDC → ~99.67 APACDC. Ordinary AMM execution.
2. **Bob trades but cannot LP.** Same pool, same asset — the venue requires a
   professional-investor claim (topic 42) to provide liquidity. `SWAP_ALLOWED` yes,
   `LIQUIDITY_ALLOWED` no.
3. **Dave is invisible to the market.** No ONCHAINID, so no permissions, and the swap reverts.
   He cannot reach the asset through any route.
4. **The agent freezes Carol.** One call in T-REX. Her next swap reverts — the venue was
   never touched.
5. **The venue blocks Japan.** A jurisdiction overlay *on top of* the issuer's own country
   module. Carol (JP) stops trading, Alice (SG) is unaffected.
6. **The issuer pauses the asset.** The entire market halts, including Alice.
7. **The custodian trades for a client.** CLIENT-A acquires the asset; the client never
   touches a key, and the hook still checks *the client's* identity.
8. **Freezing one client does not affect its siblings.** The segregation payoff — and the
   answer to "what happens to my other clients when one is sanctioned?"
9. **Only the custodian can operate a client account.** Anyone else reverts `NotCustodian`.
10. **Per-client recovery.** A forced transfer claws back from one client and no other.

## Custody model: segregated client accounts

A custodian (*Meridian Custody*) operates client accounts. Each client gets its **own**
`CustodyAccount` contract, which is the on-chain holder of record: its own ONCHAINID, its own
KYC claim, its own row in the issuer's identity registry.

```
Meridian Custody  (operator key — should be a multisig)
  ├── CLIENT-A  Sakura Asset Management   Japan      KYC + PRO   120,000
  ├── CLIENT-B  Lion City Family Office   Singapore  KYC + PRO    80,000
  ├── CLIENT-C  Harbour Retail Nominee    Hong Kong  KYC          45,000   swap only
  └── CLIENT-D  Prospect Capital          —          none              0   blocked
```

The custodian holds the keys and signs; the client never does. What makes this work with an
issuer-held allowlist is that the router reports the *client account* as `msgSender()`, so the
hook evaluates the client's identity, not the custodian's.

**Why segregated rather than omnibus.** Because each client is an independent holder, the
issuer can freeze one client, force-transfer from one client, or report on one client without
touching any other. `test_freezingOneClientDoesNotAffectOthers` proves exactly that: CLIENT-A
is frozen and CLIENT-B, under the same custodian, keeps trading. An omnibus wallet cannot give
you that — freeze it and every client stops.

`CLIENT-D` is the control: funded with cash, approvals in place, KYC not finished. Its trade
fails, and the only possible cause is the compliance gate.

> The production shape of `CustodyAccount` is an ERC-4337 account with ERC-7821 batched
> execution — exactly what OpenZeppelin's Contracts MCP emits for `solidity-account`. That
> output needs OpenZeppelin ^5.7.0 and `pragma ^0.8.27`, while Uniswap's `PermissionsAdapter`
> pins `0.8.26` exactly, so the two cannot share a compilation unit today. The contract here
> mirrors that design on the primitives available; swapping in the 4337 account is a drop-in
> once the pragmas align.

## Hosting

The dashboard is a Next.js app, but the demo's dependency is the **chain**, not the web tier.

**Deployed at https://apac-rwa-console.vercel.app** (Vercel project
`vladestoup-3112s-projects/apac-rwa-console`). Vercel hosts the console but cannot host a
chain — serverless functions have no long-running process — so the deployment reads its
target from environment variables:

| Variable | Purpose |
|---|---|
| `RPC_URL` | An RPC endpoint the Vercel server can reach |
| `CHAIN_ID` | Chain id behind that endpoint |
| `ADDRESSES_JSON` | Contents of `ops/addresses.json` (already set) |
| `DEMO_KEYS` | Signing keys as JSON; falls back to Anvil's public test keys |

Until `RPC_URL` points at a reachable chain the page renders setup guidance rather than an
error. Contract addresses are deterministic, so `ADDRESSES_JSON` stays valid across redeploys
of the same stack.

**For the live session — run it on the laptop.** `./ops/reset.sh`, then
`cd dashboard && npm run dev`. No network dependency at all, one-second blocks, and a clean
reset between meetings. This is the recommended setup: a conference-room wifi failure cannot
break it.

**If you want a shareable link — Vercel for the dashboard, Anvil on a small cloud box.**
Keeps every local advantage (no faucets, no gas, and we control the node's
`--code-size-limit`, which matters given the position-manager issue below) and gives a URL.
Three small changes are needed: read `addresses.json` from an env var rather than the
filesystem, move the demo keys into env vars, and expose the RPC.

**Public testnet is blocked today.** `PermissionedPositionManager` is ~32KB and will not
deploy under EIP-170 on a real network. That has to be solved first.

> Security note for any hosted version: the dashboard signs with keys held server-side and
> exposes freeze, pause and trade to anyone with the URL. That is fine for a disposable demo
> chain with fake assets, and must never point at anything real.

## Architecture note: two compilation units

T-REX v4.1.6 pins `solidity 0.8.17` + OpenZeppelin **v4**. Uniswap v4-periphery needs
`0.8.26` + OpenZeppelin **v5**. These cannot share a compilation unit, so the demo keeps
them separate and they interact only over ABI:

```
trex/        Hardhat · solc 0.8.17 · OZ 4.9.6   → the issuer's stack
contracts/   Foundry · solc 0.8.26 · OZ 5.0.2   → the venue's stack
```

This is not a workaround so much as the production shape: the issuer deploys T-REX, the
venue deploys pool infrastructure, and neither compiles the other's code. The venue side
declares only the ERC-3643 call surface it needs, in
[`contracts/interfaces/IERC3643.sol`](contracts/interfaces/IERC3643.sol).

### The handshake

The permissions adapter physically custodies the ERC-3643 token, so under the token's own
rules **it must be a verified holder like any other**. `trex/scripts/register-adapter.ts`
has the issuer mint the adapter an ONCHAINID, attest KYC on it via the same trusted claim
issuer used for investors, register it under an allowed jurisdiction, and seed it with
1 wei — the on-chain proof of allow-listing that `verifyPermissionsAdapter` checks for.

The venue is onboarded exactly like an investor. That is what makes the model auditable.

## Known limitations

- **`PermissionedPositionManager` is ~32KB**, over the 24,576-byte EIP-170 limit. Upstream
  fits it with a dedicated low-optimizer-runs IR profile, but that profile cannot compile
  v4-core's `Pool.sol` in this tree. The local node runs with `--code-size-limit 60000` and
  scripts use `--disable-code-size-limit`. Resolve before any public-network deployment.
- **`DemoPermissionedRouter` is a minimal stand-in.** `PermissionedV4Router` is abstract;
  production uses Uniswap's Universal Router (v2.2.0+).
- **ERC-3643 is not yet in OpenZeppelin Contracts.** The OZ ↔ T-REX Network partnership
  (July 2026) is co-development in progress. What OZ ships today for permissioned tokens is
  **ERC-7943 (uRWA)** in community-contracts (`ERC20uRWA`, `ERC20Restricted`), which is what
  the Contracts MCP `solidity-rwa` tool generates. This demo uses genuine T-REX for the
  asset and OpenZeppelin for the integration layer.
