#!/usr/bin/env bash
# Installs the multi-signature wallet's released runtime code at its canonical addresses on the
# local node, as setup-permit2.sh does for Permit2.
#
# Provenance: each file is the runtime code at the canonical address on mainnet, where the same
# code is deployed on the target test network. The hashes below were recorded when the files were
# fetched; the install refuses any file that no longer matches, and then checks what the node holds.
# On the test network nothing is installed: the canonical deployment is used as it is.
set -euo pipefail
RPC="${RPC:-http://127.0.0.1:8545}"
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/multisig"

install() {
  local name="$1" address="$2" expected="$3"
  local code
  code="$(cat "$DIR/$name.bytecode")"
  [ "$(cast keccak "$code")" = "$expected" ] || { echo "$name.bytecode does not match its recorded hash" >&2; exit 1; }
  cast rpc anvil_setCode "$address" "$code" --rpc-url "$RPC" >/dev/null
  [ "$(cast keccak "$(cast code "$address" --rpc-url "$RPC")")" = "$expected" ] || { echo "$name not installed" >&2; exit 1; }
  echo "$name installed at $address"
}

install singleton        0x41675C099F32341bf84BFc5382aF534df5C7461a 0x1fe2df852ba3299d6534ef416eefa406e56ced995bca886ab7a553e6d0c5e1c4
install proxy-factory    0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67 0x50c3cdc4074750a7a974204a716c999edd37482f907608d960b2b025ee0b3317
install fallback-handler 0xfd0732Dc9E303f09fCEf3a7388Ad10A83459Ec99 0x7c6007a5d711cea8dfd5d91f5940ec29c7f200fe511eb1fc1397b367af3c42f9
