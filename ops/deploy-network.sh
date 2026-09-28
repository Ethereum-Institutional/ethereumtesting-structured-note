#!/usr/bin/env bash
# Deploys the whole stack to a live public network (ADR 0051): an integration deployment, not
# the PoC execution, which is deployed afresh after internal assurance review (D17).
#
#   NETWORK_FILE=ops/networks/base-sepolia.json KEYS=ops/keys.base-sepolia-integration.env \
#     ./ops/deploy-network.sh
#
# Refuses the local node's published keys, and refuses to start until every capacity that sends a
# transaction holds gas and the Deposit Agent holds the payment token to seed the pool. Writes
# ops/addresses.<network>.json. Everything it does is public and permanent.
set -euo pipefail
export PATH="$HOME/.foundry/bin:$PATH"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

export NETWORK_FILE="${NETWORK_FILE:?set NETWORK_FILE}"
export KEYS="${KEYS:?set KEYS to the network key file}"
net() { jq -er "$1" "$NETWORK_FILE"; }
set -a; source "$KEYS"; set +a

# Never the local node's keys (ADR 0041).
PUBLISHED="$(grep -oE '0x[0-9a-fA-F]{64}' ops/keys.env | tr 'A-F' 'a-f')"
for v in ISSUER_PK AGENT_PK ACCESS_ISSUER_PK DEPOSIT_AGENT_PK CUSTODIAN_PK INVESTOR_A_PK INVESTOR_B_PK INVESTOR_C_PK INVESTOR_D_PK CALCULATION_AGENT_PK; do
  echo "$PUBLISHED" | grep -qx "$(echo "${!v}" | tr 'A-F' 'a-f')" && { echo "$v is a published local key; refusing" >&2; exit 1; }
done
[ -n "${WALLET_MNEMONIC:-}" ] || { echo "WALLET_MNEMONIC is not set in $KEYS" >&2; exit 1; }

export RPC="$(net .rpcUrl)"
[ "$(cast chain-id --rpc-url "$RPC")" = "$(net .chainId)" ] || { echo "RPC is not chain $(net .chainId)" >&2; exit 1; }
export MANIFEST="ops/addresses.$(basename "$NETWORK_FILE" .json).json"
export PUBLIC_NETWORK=1
export FORGE_FLAGS="--slow"
for k in NOTE_NAME NOTE_SYMBOL DEPOSIT_NAME DEPOSIT_SYMBOL TERM_SHEET_URI TERM_SHEET_HASH; do
  export "$k=$(net ".names.$k")"
done

# Gas for every capacity that sends a transaction; the deployer sends most of them.
short=0
need() {
  local cap="$1" min="$2" pk="${1}_PK" addr bal
  addr="$(cast wallet address "${!pk}")"
  bal="$(cast balance "$addr" --rpc-url "$RPC")"
  if [ "$(python3 -c "print(int($bal) < int($min))")" = True ]; then
    printf '  %-16s %s holds %s wei, needs %s\n' "$cap" "$addr" "$bal" "$min"; short=1
  fi
}
echo "Checking balances on chain $(net .chainId):"
need ISSUER 20000000000000000   # 0.02
for cap in AGENT ACCESS_ISSUER DEPOSIT_AGENT CUSTODIAN INVESTOR_A INVESTOR_B INVESTOR_C INVESTOR_D; do
  need "$cap" 2000000000000000  # 0.002
done
TOKEN="$(net .paymentToken.address)"
DA="$(cast wallet address "$DEPOSIT_AGENT_PK")"
PT="$(cast call "$TOKEN" 'balanceOf(address)(uint256)' "$DA" --rpc-url "$RPC" | awk '{print $1}')"
[ "$PT" != 0 ] || { printf '  %-16s %s holds none of the payment token (%s)\n' DEPOSIT_AGENT "$DA" "$(net .paymentToken.symbol)"; short=1; }
[ "$short" = 0 ] || { echo "Fund the accounts above, then run again." >&2; exit 1; }

echo "Deploying to chain $(net .chainId). This is public and permanent."
./ops/deploy-stack.sh
echo "Addresses in $MANIFEST"
