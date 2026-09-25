#!/usr/bin/env bash
# Installs the credential protocol's released registry implementations at their canonical
# addresses on the local node (ADR 0040), as setup-multisig.sh does for the wallet.
#
# Provenance: each file is the runtime code of the implementation behind the protocol's issuer and
# revocation registry proxies on the target test network, read from each proxy's ERC-1967
# implementation slot on 25 September 2026. The implementations embed their own address, so they
# work only at that address. The install refuses any file whose hash has changed, then checks what
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

install issuer-registry     0x4a1a49bbb0042f75541d44297a8746525d9b05ac 0x343fab876697de2d18847b40853a3345695e3a8231d5860c285204983a746d25
install revocation-registry 0xa8e508d587702b2fada23f9c55f277e1b29ede33 0x64a0ea323b0beb31d0d00fc6ef680283a1acff6f9e3e5600dac9c86e8ac9b959
