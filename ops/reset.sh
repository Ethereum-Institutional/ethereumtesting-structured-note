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
      foundry.toml instruments/foundry.toml instruments/soldeer.lock remappings.txt instruments/remappings.txt \
      'ops/*.sh' ops/keys.env site/scripts/term-sheet.ts site/lib/notes/termsheet.ts | grep -v '^ops/reset.sh$' | sort | xargs shasum 2>/dev/null
    git submodule status --recursive 2>/dev/null
    anvil --version | head -1
  } | shasum | cut -c1-16
}

rpc() { curl -sf -H 'content-type: application/json' --data "$1" "$RPC"; }

KEY="$(key)"
SNAP="$SNAPSHOTS/$KEY"

printf '\n\033[1m── local chain\033[0m\n'
if [ "${FRESH:-0}" != 1 ] && [ -s "$SNAP/state.json" ] && [ -s "$SNAP/addresses.json" ]; then
  # Loaded as the node starts: a deployment's state is too large for a single JSON-RPC request.
  ANVIL_LOAD_STATE="$SNAP/state.json" ./ops/anvil.sh
  [ "$(cast block-number --rpc-url "$RPC" 2>/dev/null || echo 0)" -gt 0 ] \
    || { echo "restoring the snapshot failed; deploying afresh" >&2; rm -rf "$SNAP"; exec env FRESH=1 "$ROOT/ops/reset.sh"; }
  # The restored chain resumes from the snapshot's clock; bring it up to the present, as a fresh
  # deployment would be, so a time the site takes from the wall clock is not in the chain's future.
  rpc "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"evm_setNextBlockTimestamp\",\"params\":[$(date +%s)]}" >/dev/null
  rpc '{"jsonrpc":"2.0","id":1,"method":"evm_mine","params":[]}' >/dev/null
  cp "$SNAP/addresses.json" ops/addresses.json
  printf '\n\033[1mReady.\033[0m Restored snapshot %s (block %s). FRESH=1 to deploy afresh.\n\n' "$KEY" "$(cast block-number --rpc-url "$RPC")"
  exit 0
fi

./ops/anvil.sh
./ops/deploy-stack.sh

# Saved for the next reset; older snapshots are left for other branches, the newest few kept.
mkdir -p "$SNAP"
# anvil_dumpState answers gzipped JSON, hex-encoded; the node loads the JSON as it starts.
rpc '{"jsonrpc":"2.0","id":1,"method":"anvil_dumpState","params":[]}' | sed -E 's/.*"result":"0x([0-9a-fA-F]*)".*/\1/' | xxd -r -p | gunzip > "$SNAP/state.json"
cp ops/addresses.json "$SNAP/addresses.json"
ls -1t "$SNAPSHOTS" | tail -n +6 | while read -r old; do rm -rf "${SNAPSHOTS:?}/$old"; done

printf '\n\033[1mReady.\033[0m Addresses in ops/addresses.json; snapshot %s saved.\n' "$KEY"
printf '  verify: forge test --fork-url http://127.0.0.1:8545 -vv\n\n'
