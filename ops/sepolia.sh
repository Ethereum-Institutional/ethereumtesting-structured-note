#!/usr/bin/env bash
# Short commands for the Ethereum Sepolia deployment, so none is long enough to wrap when pasted.
#
#   ./ops/sepolia.sh check      balances only; sends nothing
#   ./ops/sepolia.sh deploy     the whole stack, verified on Etherscan (public and permanent)
#   ./ops/sepolia.sh verify     retry Etherscan verification
#   ./ops/sepolia.sh site-env   point the site's Vercel project at this deployment
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
export NETWORK_FILE=ops/networks/ethereum-sepolia.json
export KEYS=ops/keys.ethereum-sepolia.env
MANIFEST_FILE=ops/addresses.ethereum-sepolia.json
case "${1:-}" in
  check) CHECK_ONLY=1 ./ops/deploy-network.sh ;;
  deploy) ./ops/deploy-network.sh ;;
  verify) python3 ops/verify-contracts.py ;;
  site-env) ./ops/vercel-env.sh "$MANIFEST_FILE" "$NETWORK_FILE" "$KEYS" ;;
  *) sed -n '2,8p' "$0" >&2; exit 1 ;;
esac
