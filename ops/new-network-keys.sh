#!/usr/bin/env bash
# Generates a fresh key set for a deployment on a public network: one new mnemonic,
# with every capacity at the same index as on the local node (keys.env) and the ceremony's wallet
# signers at indices 10 to 21, and the third-party custodian at 22. The local node's
# published keys are never used off it: on the test network they carry EIP-7702 delegations set by whoever holds them.
#
#   ./ops/new-network-keys.sh base-sepolia-integration
#
# Writes ops/keys.<name>.env, which .gitignore excludes, readable by the owner only, and refuses
# to overwrite one that exists. Prints addresses, never keys.
set -euo pipefail
export PATH="$HOME/.foundry/bin:$PATH"
NAME="${1:?usage: new-network-keys.sh <name>}"
OUT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/keys.$NAME.env"
[ -e "$OUT" ] && { echo "$OUT exists; not overwriting" >&2; exit 1; }

MNEMONIC="$(cast wallet new-mnemonic --words 24 | awk '/^Phrase:/{getline; print; exit}')"
[ "$(echo "$MNEMONIC" | wc -w | tr -d ' ')" = 24 ] || { echo "could not read the new mnemonic" >&2; exit 1; }
key() { cast wallet private-key --mnemonic "$MNEMONIC" --mnemonic-index "$1"; }

umask 077
{
  echo "# Keys for the $NAME deployment. Generated $(date -u +%Y-%m-%dT%H:%MZ). Never commit."
  echo "export WALLET_MNEMONIC=\"$MNEMONIC\"  # ceremony wallet signers, indices 10 to 21"
  i=0
  for cap in ISSUER AGENT ACCESS_ISSUER INVESTOR_A INVESTOR_B INVESTOR_C INVESTOR_D CALCULATION_AGENT CUSTODIAN DEPOSIT_AGENT; do
    echo "export ${cap}_PK=$(key $i)  # account $i"
    i=$((i + 1))
  done
  echo "export THIRD_PARTY_CUSTODIAN_PK=$(key 22)  # account 22"
} > "$OUT"
chmod 600 "$OUT"

echo "Wrote $OUT. Addresses to fund:"
set -a; source "$OUT"; set +a
for cap in ISSUER AGENT ACCESS_ISSUER INVESTOR_A INVESTOR_B INVESTOR_C INVESTOR_D CALCULATION_AGENT CUSTODIAN DEPOSIT_AGENT THIRD_PARTY_CUSTODIAN; do
  v="${cap}_PK"; printf '  %-22s %s\n' "$cap" "$(cast wallet address "${!v}")"
done
