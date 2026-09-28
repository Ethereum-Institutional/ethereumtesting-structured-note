#!/usr/bin/env bash
# Installs the credential protocol's released registry implementations at their canonical
# addresses on the local node (ADR 0040), as setup-multisig.sh does for the wallet.
#
# Provenance: each file is the runtime code of the implementation behind the protocol's issuer and
# revocation registry proxies on the target test network (the pair named in the network file),
# read from each proxy's ERC-1967 implementation slot on 25 September 2026. The implementations
# embed their own address, so they work only at that address. The install refuses any file whose hash has changed, then checks what
# the node holds. Proxies in front of them are deployed by script/00_DeployBase.s.sol.
# On the test network nothing is installed: the protocol's own deployment is used as it is.
set -euo pipefail
RPC="${RPC:-http://127.0.0.1:8545}"
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/credential-protocol"

install() {
  local name="$1" address="$2" expected="$3"
  local code
  code="$(cat "$DIR/$name.bytecode")"
  [ "$(cast keccak "$code")" = "$expected" ] || { echo "$name.bytecode does not match its recorded hash" >&2; exit 1; }
  cast rpc anvil_setCode "$address" "$code" --rpc-url "$RPC" >/dev/null
  [ "$(cast keccak "$(cast code "$address" --rpc-url "$RPC")")" = "$expected" ] || { echo "$name not installed" >&2; exit 1; }
  echo "$name installed at $address"
}

install issuer-registry     0x747276b7ff453fc0b067704d0d2979d6dc145ae9 0x8e02890d2f7f219abcf0180a9934370215918a5cc5a1354f591b3348379af191
install revocation-registry 0x8e5cc797abc82964dc29670c919a37917128a9a9 0x0d6871fc409bf03a8796002d6c40e0d293a5b1eadf51ae88914dc7a7dfa187c8
