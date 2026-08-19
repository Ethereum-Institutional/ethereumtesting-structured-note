#!/usr/bin/env bash
# Deploys the whole stack onto an already-running chain, in dependency order.
#
# Split out of reset.sh so the same sequence can be replayed against a chain started
# elsewhere -- notably ops/bake-state.sh, which needs to control anvil's lifecycle in order
# to dump a state snapshot.
#
# The ordering is genuinely sequential and cannot be parallelised:
#   - the pool adapter must exist before the issuer can allow-list it
#   - the adapter must be allow-listed before the venue can verify it
#   - custody accounts must exist before the issuer can KYC them
#   - clients must be KYC'd before the agent can allocate them the asset
set -euo pipefail
export PATH="$HOME/.foundry/bin:$PATH"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
source ./ops/keys.env

RPC="${RPC:-http://127.0.0.1:8545}"
FS="--rpc-url $RPC --broadcast --disable-code-size-limit"

step() { printf '\n\033[1m── %s\033[0m\n' "$1"; }

step "Permit2 at its canonical address"
RPC="$RPC" ./ops/setup-permit2.sh

step "ERC-3643 issuer stack  (solc 0.8.17 / OZ 4.9.6)"
( cd trex && npx hardhat run scripts/deploy.ts --network anvil )

step "Uniswap v4 venue  (solc 0.8.26 / OZ 5.0.2)"
forge script script/01_DeployVenue.s.sol:DeployVenue $FS >/dev/null
echo "   venue contracts deployed"

step "issuer allow-lists the pool adapter"
( cd trex && npx hardhat run scripts/register-adapter.ts --network anvil )

step "venue activated, pool opened and seeded"
forge script script/02_ActivateVenue.s.sol:ActivateVenue $FS >/dev/null
forge script script/03_DeployLens.s.sol:DeployLens $FS >/dev/null
echo "   pool live with liquidity"

step "custodian and segregated client accounts"
forge script script/04_DeployCustody.s.sol:DeployCustody $FS >/dev/null
echo "   custody accounts deployed and funded"

step "issuer onboards the custody clients"
( cd trex && npx hardhat run scripts/onboard-custody.ts --network anvil )
