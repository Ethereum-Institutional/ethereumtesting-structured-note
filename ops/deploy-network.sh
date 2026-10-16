#!/usr/bin/env bash
# Deploys the whole stack to a live public network (ADR 0051): an integration deployment, not
# the PoC execution, which is deployed afresh after internal assurance review (D17).
#
#   NETWORK_FILE=ops/networks/ethereum-sepolia.json KEYS=ops/keys.ethereum-sepolia.env \
#     ./ops/deploy-network.sh
#
# CHECK_ONLY=1 checks the keys and balances and stops before sending anything.
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
for v in ISSUER_PK AGENT_PK ACCESS_ISSUER_PK DEPOSIT_AGENT_PK CUSTODIAN_PK INVESTOR_A_PK INVESTOR_B_PK INVESTOR_C_PK INVESTOR_D_PK CALCULATION_AGENT_PK THIRD_PARTY_CUSTODIAN_PK; do
  echo "$PUBLISHED" | grep -qx "$(echo "${!v}" | tr 'A-F' 'a-f')" && { echo "$v is a published local key; refusing" >&2; exit 1; }
done
[ -n "${WALLET_MNEMONIC:-}" ] || { echo "WALLET_MNEMONIC is not set in $KEYS" >&2; exit 1; }

export RPC="$(net .rpcUrl)"
[ "$(cast chain-id --rpc-url "$RPC")" = "$(net .chainId)" ] || { echo "RPC is not chain $(net .chainId)" >&2; exit 1; }
export MANIFEST="ops/addresses.$(basename "$NETWORK_FILE" .json).json"
export PUBLIC_NETWORK=1
for k in NOTE_NAME NOTE_SYMBOL DEPOSIT_NAME DEPOSIT_SYMBOL TERM_SHEET_BASE; do
  export "$k=$(net ".names.$k")"
done

# Gas for every capacity that sends a transaction: what the deployment used on a fork of Ethereum
# Sepolia, under Amsterdam's prices for state creation (ADR 0098), with a tenth more. Each must hold
# that at three times today's gas price, so a rise during the run does not strand it halfway, and
# never less than 0.01 ETH.
GAS_PRICE="$(cast gas-price --rpc-url "$RPC")"
short=0
need() {
  local cap="$1" gas="$2" pk="${1}_PK" addr bal min
  addr="$(cast wallet address "${!pk}")"
  bal="$(cast balance "$addr" --rpc-url "$RPC")"
  min="$(python3 -c "print(max(int($gas) * int($GAS_PRICE) * 3, 10**16))")"
  if [ "$(python3 -c "print(int($bal) < int($min))")" = True ]; then
    printf '  %-22s %s holds %s ETH, needs %s\n' "$cap" "$addr" "$(cast from-wei "$bal")" "$(cast from-wei "$min")"; short=1
  fi
}
echo "Checking balances on chain $(net .chainId), gas at $(cast from-wei "$GAS_PRICE" gwei) gwei:"
need ISSUER                580000000
need DEPOSIT_AGENT          61000000
need CUSTODIAN              43000000
need THIRD_PARTY_CUSTODIAN  19000000
need ACCESS_ISSUER          10000000
need INVESTOR_A              3000000
need INVESTOR_B              3000000
need INVESTOR_C              1000000
need INVESTOR_D               500000
need AGENT                    500000
TOKEN="$(net .paymentToken.address)"
DA="$(cast wallet address "$DEPOSIT_AGENT_PK")"
PT="$(cast call "$TOKEN" 'balanceOf(address)(uint256)' "$DA" --rpc-url "$RPC" | awk '{print $1}')"
[ "$PT" != 0 ] || { printf '  %-16s %s holds none of the payment token (%s)\n' DEPOSIT_AGENT "$DA" "$(net .paymentToken.symbol)"; short=1; }
[ "$short" = 0 ] || { echo "Fund the accounts above, then run again." >&2; exit 1; }
# CHECK_ONLY=1 stops here: the balances checked, nothing sent.
[ "${CHECK_ONLY:-0}" = 1 ] && { echo "Every account is funded. Nothing sent (CHECK_ONLY)."; exit 0; }

echo "Deploying to chain $(net .chainId). This is public and permanent."
./ops/deploy-stack.sh
echo "Addresses in $MANIFEST"

# Every contract verified on the chain's explorer, where the key file holds an Etherscan key (ADR 0113).
if [ -n "${ETHERSCAN_API_KEY:-}" ]; then
  echo "Verifying the contracts on the explorer:"
  python3 ops/verify-contracts.py || echo "Some contracts were not verified; run ops/verify-contracts.py again to retry them." >&2
else
  echo "No ETHERSCAN_API_KEY in $KEYS: the contracts are not verified. Add one and run ops/verify-contracts.py."
fi
