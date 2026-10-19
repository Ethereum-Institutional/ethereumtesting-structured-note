#!/usr/bin/env bash
# The fork dry run: forks the public test network, deploys the whole stack against
# its real contracts (pool manager, Permit2, the multi-signature wallet and the euro payment
# token), and runs the venue tests against the result.
#
# Nothing is published: every transaction lands on the local fork. The names, symbols and term
# sheet values the deploy guard requires come from the network file.
#
#   NETWORK_FILE=ops/networks/base-sepolia.json ./ops/dry-run-fork.sh
#
# The payment token cannot be minted on a fork, so balances are written directly to its storage
# at the balance slot the network file records, and read back through balanceOf to prove it.
set -euo pipefail
export PATH="$HOME/.foundry/bin:$PATH"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
source ./ops/keys.env

export NETWORK_FILE="${NETWORK_FILE:-ops/networks/base-sepolia.json}"
[ -f "$NETWORK_FILE" ] || { echo "no network file at $NETWORK_FILE; copy the template in ops/networks/" >&2; exit 1; }
net() { jq -er "$1" "$NETWORK_FILE"; }

PORT="${PORT:-8547}"
export RPC="http://127.0.0.1:$PORT"
export MANIFEST="ops/addresses.$(basename "$NETWORK_FILE" .json)-fork.json"
export PUBLIC_NETWORK=1
# The fork is private, so the dry run uses the local node's published keys and mnemonic, which a
# live deployment never does (ops/deploy-network.sh refuses them).
export WALLET_MNEMONIC="test test test test test test test test test test test junk"
LOG="$(mktemp -t fork-anvil)"

pkill -f "anvil --port $PORT" 2>/dev/null || true
nohup anvil --port "$PORT" --fork-url "$(net .rpcUrl)" --chain-id "$(net .chainId)" --accounts 23 --silent >"$LOG" 2>&1 &
# KEEP_FORK=1 leaves the fork running afterwards, to inspect it.
[ "${KEEP_FORK:-0}" = 1 ] || trap 'pkill -f "anvil --port $PORT" 2>/dev/null || true' EXIT
for _ in $(seq 1 60); do cast chain-id --rpc-url "$RPC" >/dev/null 2>&1 && break; sleep 1; done
printf '\033[1mFork of chain %s at block %s\033[0m\n' "$(cast chain-id --rpc-url "$RPC")" "$(cast block-number --rpc-url "$RPC")"

# The deploy guard's values, set explicitly from the network file.
for k in NOTE_NAME NOTE_SYMBOL DEPOSIT_NAME DEPOSIT_SYMBOL TERM_SHEET_BASE; do
  export "$k=$(net ".names.$k")"
done

TOKEN="$(net .paymentToken.address)"
SLOT="$(net .paymentToken.balanceSlot)"
fund() {
  local account="$1" amount="$2"
  cast rpc anvil_setStorageAt "$TOKEN" "$(cast index address "$account" "$SLOT")" \
    "$(cast to-uint256 "$amount")" --rpc-url "$RPC" >/dev/null
  [ "$(cast call "$TOKEN" 'balanceOf(address)(uint256)' "$account" --rpc-url "$RPC" | awk '{print $1}')" = "$amount" ] \
    || { echo "payment token balance slot $SLOT is wrong for $TOKEN" >&2; exit 1; }
}
for pk in "$INVESTOR_A_PK" "$INVESTOR_B_PK" "$INVESTOR_C_PK" "$INVESTOR_D_PK"; do fund "$(cast wallet address "$pk")" 500000000000; done
fund "$(cast wallet address "$DEPOSIT_AGENT_PK")" 100000000000   # EUR 100,000 of the payment token seeds the pool
echo "payment token balances written and read back"

./ops/deploy-stack.sh

for ref in SEG-0001 SEG-0002 SEG-0003 SEG-0004; do fund "$(jq -er ".custody.accounts[\"$ref\"]" "$MANIFEST")" 500000000000; done

printf '\n\033[1m── venue tests against the fork\033[0m\n'
# Forge caches forked state by chain id and block number, which a previous dry run shares, so
# the cache is off here.
forge test --fork-url "$RPC" --no-storage-caching \
  --match-path 'test/{PermissionedTrading,CustodyTrading}.t.sol' "${@}"
