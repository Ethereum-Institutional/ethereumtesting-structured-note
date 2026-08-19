#!/usr/bin/env bash
# Starts the local demo chain.
#
# --code-size-limit: PermissionedPositionManager compiles to ~32KB with the IR settings
# v4-core's Pool library requires. Upstream v4-periphery fits it under EIP-170 with a
# dedicated low-optimizer-runs profile, but that profile cannot compile Pool.sol in this
# tree. Raising the local limit keeps the real position manager -- with its
# non-transferable positions and issuer unwind -- in the demo. See ops/README.md.
set -euo pipefail
export PATH="$HOME/.foundry/bin:$PATH"
LOG="${LOG:-/tmp/anvil-apac-demo.log}"

pkill -f "anvil --chain-id 31337" 2>/dev/null || true
sleep 1
nohup anvil \
  --chain-id 31337 \
  --block-time 1 \
  --code-size-limit 60000 \
  --silent > "$LOG" 2>&1 &

for _ in $(seq 1 30); do
  if cast block-number --rpc-url http://127.0.0.1:8545 >/dev/null 2>&1; then
    echo "anvil up (chain 31337, code-size-limit 60000), log: $LOG"
    exit 0
  fi
  sleep 0.5
done
echo "anvil failed to start; see $LOG" >&2
exit 1
