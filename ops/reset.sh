#!/usr/bin/env bash
# Starts a fresh local chain with the stack deployed on it.
#
# Deploying the stack takes minutes, one transaction a block. So the chain as the deployment
# leaves it is saved once, with its manifest, and a reset restores that snapshot into a new chain
# in seconds (ADR 0079). The snapshot is keyed by everything the deployment is made from (the
# contracts, the deployment scripts and settings, the dependencies' versions), so any change to
# those deploys afresh. FRESH=1 always deploys afresh.
set -euo pipefail
export PATH="$HOME/.foundry/bin:$PATH"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
RPC="${RPC:-http://127.0.0.1:8545}"
SNAPSHOTS="$ROOT/ops/.chain-snapshots"

# What the deployment is made from, tracked or not, and the dependencies' commits.
key() {
  {
    git ls-files -co --exclude-standard -- contracts script instruments/src instruments/script \
      foundry.toml instruments/foundry.toml remappings.txt instruments/remappings.txt \
      'ops/*.sh' ops/keys.env | grep -v '^ops/reset.sh$' | sort | xargs shasum 2>/dev/null
    git submodule status --recursive 2>/dev/null
    anvil --version | head -1
  } | shasum | cut -c1-16
}

rpc() { curl -sf -H 'content-type: application/json' --data "$1" "$RPC"; }

KEY="$(key)"
SNAP="$SNAPSHOTS/$KEY"

printf '\n\033[1m── local chain\033[0m\n'
./ops/anvil.sh

if [ "${FRESH:-0}" != 1 ] && [ -s "$SNAP/state.hex" ] && [ -s "$SNAP/addresses.json" ]; then
  printf '{"jsonrpc":"2.0","id":1,"method":"anvil_loadState","params":["%s"]}' "$(cat "$SNAP/state.hex")" > "$SNAP/load.json"
  curl -sf -H 'content-type: application/json' --data @"$SNAP/load.json" "$RPC" | grep -q '"result":true' \
    || { echo "restoring the snapshot failed; deploying afresh" >&2; rm -rf "$SNAP"; exec env FRESH=1 "$0"; }
  rm -f "$SNAP/load.json"
  # The restored chain resumes from the snapshot's clock; bring it up to the present, as a fresh
  # deployment would be, so a time the site takes from the wall clock is not in the chain's future.
  rpc "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"evm_setNextBlockTimestamp\",\"params\":[$(date +%s)]}" >/dev/null
  rpc '{"jsonrpc":"2.0","id":1,"method":"evm_mine","params":[]}' >/dev/null
  cp "$SNAP/addresses.json" ops/addresses.json
  printf '\n\033[1mReady.\033[0m Restored snapshot %s (block %s). FRESH=1 to deploy afresh.\n\n' "$KEY" "$(cast block-number --rpc-url "$RPC")"
  exit 0
fi

./ops/deploy-stack.sh

# Saved for the next reset; older snapshots are left for other branches, the newest few kept.
mkdir -p "$SNAP"
rpc '{"jsonrpc":"2.0","id":1,"method":"anvil_dumpState","params":[]}' | sed -E 's/.*"result":"(0x[0-9a-fA-F]*)".*/\1/' > "$SNAP/state.hex"
cp ops/addresses.json "$SNAP/addresses.json"
ls -1t "$SNAPSHOTS" | tail -n +6 | while read -r old; do rm -rf "${SNAPSHOTS:?}/$old"; done

printf '\n\033[1mReady.\033[0m Addresses in ops/addresses.json; snapshot %s saved.\n' "$KEY"
printf '  verify: forge test --fork-url http://127.0.0.1:8545 -vv\n\n'
