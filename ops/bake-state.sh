#!/usr/bin/env bash
# Bakes a fully-deployed chain into a single state snapshot.
#
# The hosted chain does not need the toolchain that built it -- Foundry, Hardhat, the whole
# dependency tree. It only needs anvil plus the resulting state. This script starts anvil with
# --dump-state, deploys the full stack, then stops it so the snapshot is written.
#
# Anvil's account addresses and CREATE/CREATE2 derivation are deterministic, so the addresses
# in the snapshot match ops/addresses.json exactly -- which is what lets the same
# ADDRESSES_JSON serve both the laptop and the hosted console.
set -euo pipefail
export PATH="$HOME/.foundry/bin:$PATH"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

STATE="$ROOT/ops/anvil-state.json"
LOG=/tmp/anvil-bake.log

pkill -f "anvil --chain-id 31337" 2>/dev/null || true
sleep 1
rm -f "$STATE"

echo "starting anvil with state dumping enabled"
nohup anvil \
  --chain-id 31337 \
  --block-time 1 \
  --code-size-limit 60000 \
  --dump-state "$STATE" \
  --silent > "$LOG" 2>&1 &
ANVIL_PID=$!

for _ in $(seq 1 40); do
  cast block-number --rpc-url http://127.0.0.1:8545 >/dev/null 2>&1 && break
  sleep 0.5
done

./ops/deploy-stack.sh

echo
echo "stopping anvil to flush the snapshot"
kill -TERM "$ANVIL_PID" 2>/dev/null || true
for _ in $(seq 1 60); do
  [ -s "$STATE" ] && break
  sleep 0.5
done
wait "$ANVIL_PID" 2>/dev/null || true

if [ ! -s "$STATE" ]; then
  echo "FAILED: no state written to $STATE" >&2
  exit 1
fi
echo "snapshot: $STATE ($(du -h "$STATE" | cut -f1))"
