# ops

| File | Purpose |
|---|---|
| `reset.sh` | Full clean deploy in dependency order. Start here. |
| `anvil.sh` | Starts the local chain. The standard EIP-170 limit is enforced. |
| `setup-permit2.sh` | Installs canonical Permit2 bytecode at its mainnet address. |
| `keys.env` | Anvil default accounts mapped to demo roles. `source` it. |
| `addresses.json` | Every deployed address. Written by the deploy scripts, read by the tests and dashboard. |

## Order of operations

The deploy is genuinely sequential — the adapter address must exist before the issuer can
allow-list it, and the adapter must be allow-listed before the venue can verify it:

```
anvil → permit2 → T-REX (hardhat) → venue (forge) → register adapter (hardhat) → activate (forge)
```

`reset.sh` runs all six.

## Why Permit2 is installed by RPC

Permit2 pins `solidity 0.8.17` while the venue build is `0.8.26`, so it cannot be compiled
in-tree. Upstream solves this by etching precompiled bytecode in tests; we do the equivalent
over `anvil_setCode` so the local node carries Permit2 at the same address as mainnet.
