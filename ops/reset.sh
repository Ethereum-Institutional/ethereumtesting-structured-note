#!/usr/bin/env bash
# Starts a fresh local chain and deploys the stack onto it.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

printf '\n\033[1m── local chain\033[0m\n'
./ops/anvil.sh

./ops/deploy-stack.sh

printf '\n\033[1mReady.\033[0m Addresses in ops/addresses.json\n'
printf '  verify: forge test --fork-url http://127.0.0.1:8545 -vv\n\n'
