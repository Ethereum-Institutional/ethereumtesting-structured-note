#!/usr/bin/env bash
# Places the canonical Permit2 bytecode at its mainnet address on the local node.
# Permit2 pins solc 0.8.17 while the venue build is 0.8.26, so it cannot be compiled
# in-tree -- upstream solves this by etching precompiled bytecode, and we do the
# equivalent over RPC so the deployed node matches mainnet's Permit2 address exactly.
set -euo pipefail
RPC="${RPC:-http://127.0.0.1:8545}"
PERMIT2=0x000000000022D473030F116dDEE9F6B43aC78BA3
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

cast rpc anvil_setCode "$PERMIT2" "$(cat "$DIR/permit2.bytecode")" --rpc-url "$RPC" >/dev/null
SIZE=$(cast code "$PERMIT2" --rpc-url "$RPC" | wc -c | tr -d ' ')
echo "Permit2 installed at $PERMIT2 (${SIZE} bytes of hex)"
