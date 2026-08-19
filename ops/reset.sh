#!/usr/bin/env bash
# Full clean rebuild of the demo environment, in dependency order.
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

RPC=http://127.0.0.1:8545
FS="--rpc-url $RPC --broadcast --disable-code-size-limit"

step() { printf '\n\033[1m── %s\033[0m\n' "$1"; }

step "1/8  local chain"
./ops/anvil.sh

step "2/8  Permit2 at its canonical address"
./ops/setup-permit2.sh

step "3/8  ERC-3643 issuer stack  (solc 0.8.17 / OZ 4.9.6)"
( cd trex && npx hardhat run scripts/deploy.ts --network anvil )

step "4/8  Uniswap v4 venue  (solc 0.8.26 / OZ 5.0.2)"
forge script script/01_DeployVenue.s.sol:DeployVenue $FS >/dev/null
echo "   venue contracts deployed"

step "5/8  issuer allow-lists the pool adapter"
( cd trex && npx hardhat run scripts/register-adapter.ts --network anvil )

step "6/8  venue activated, pool opened and seeded"
forge script script/02_ActivateVenue.s.sol:ActivateVenue $FS >/dev/null
forge script script/03_DeployLens.s.sol:DeployLens $FS >/dev/null
echo "   pool live with liquidity"

step "7/8  custodian and segregated client accounts"
forge script script/04_DeployCustody.s.sol:DeployCustody $FS >/dev/null
echo "   custody accounts deployed and funded"

step "8/8  issuer onboards the custody clients"
( cd trex && npx hardhat run scripts/onboard-custody.ts --network anvil )

printf '\n\033[1mReady.\033[0m Addresses in ops/addresses.json\n'
printf '  verify:    forge test --fork-url %s -vv\n' "$RPC"
printf '  dashboard: cd dashboard && npm run dev\n\n'
