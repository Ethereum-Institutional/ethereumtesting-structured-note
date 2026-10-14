#!/usr/bin/env bash
# Builds both compilation units and fails if any deployable contract exceeds EIP-170.
#
# The venue (repository root) and the instruments (instruments/) cannot share a unit; see
# docs/spikes/01-contract-size.md. `forge build --sizes` exits non-zero when a contract is over
# the limit, so each unit's own build is the check.
#
# Also refuses to build if the submodules are missing. The instruments' dependencies (T-REX,
# ONCHAINID, OpenZeppelin) are pinned in instruments/soldeer.lock and fetched here; moving a pin is
# a deliberate act, recorded in an ADR (ADR 0085).
set -euo pipefail
export PATH="$HOME/.foundry/bin:$PATH"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

step() { printf '\n\033[1m── %s\033[0m\n' "$1"; }
fail() { printf '\n\033[31m%s\033[0m\n' "$1" >&2; exit 1; }

for dir in lib/v4-periphery/lib/v4-core lib/uniswap-hooks/src lib/forge-std/src; do
  [ -d "$dir" ] || fail "Missing $dir. Run: git submodule update --init --recursive"
done
( cd instruments && forge soldeer install >/dev/null ) || fail "Could not fetch the instruments' dependencies (forge soldeer install)."

step "venue  (solc 0.8.26, IR)"
forge build --sizes

step "instruments  (solc 0.8.30, T-REX 5.0.0-beta2, ONCHAINID 2.2.2-beta3)"
( cd instruments && forge build --sizes )

printf '\n\033[1mBoth units build and every contract is within EIP-170.\033[0m\n'
