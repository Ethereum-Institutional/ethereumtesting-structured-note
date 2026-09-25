#!/usr/bin/env bash
# Starts the local chain.
#
# The default EIP-170 code-size limit is enforced, as on any public network. The position
# managers fit under it through per-path compiler restrictions in foundry.toml.
set -euo pipefail
export PATH="$HOME/.foundry/bin:$PATH"
LOG="${LOG:-/tmp/anvil-local.log}"

pkill -f "anvil --chain-id 31337" 2>/dev/null || true
sleep 1
# 22 funded accounts: the ten capacities, and twelve wallet signers from index 10 (Ceremony).
nohup anvil \
  --chain-id 31337 \
  --accounts 22 \
  --block-time 1 \
  --silent > "$LOG" 2>&1 &

for _ in $(seq 1 30); do
  if cast block-number --rpc-url http://127.0.0.1:8545 >/dev/null 2>&1; then
    echo "anvil up (chain 31337), log: $LOG"
    exit 0
  fi
  sleep 0.5
done
echo "anvil failed to start; see $LOG" >&2
exit 1
