#!/usr/bin/env bash
# Builds both compilation units and fails if any deployable contract exceeds EIP-170.
#
# The venue (repository root) and the instruments (instruments/) cannot share a unit; see
# docs/spikes/01-contract-size.md. `forge build --sizes` exits non-zero when a contract is over
# the limit, so each unit's own build is the check.
#
# Also refuses to build if the submodules are missing, or if the debt standard is not at the
# pin the audit firm has been told about. Moving that pin is a deliberate act: change
# DEBT_STANDARD_PIN here in the same commit, and record it in HANDOFF.md.
set -euo pipefail
export PATH="$HOME/.foundry/bin:$PATH"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

DEBT_STANDARD_PIN="v3.3.0-rc3"

step() { printf '\n\033[1m── %s\033[0m\n' "$1"; }
fail() { printf '\n\033[31m%s\033[0m\n' "$1" >&2; exit 1; }

for dir in lib/v4-periphery/lib/v4-core lib/uniswap-hooks/src lib/forge-std/src \
  instruments/lib/debt-standard/contracts \
  instruments/lib/debt-standard/lib/openzeppelin-contracts-upgradeable/lib/openzeppelin-contracts/contracts; do
  [ -d "$dir" ] || fail "Missing $dir. Run: git submodule update --init --recursive"
done

pin="$(git -C instruments/lib/debt-standard describe --tags --exact-match 2>/dev/null || echo "untagged")"
[ "$pin" = "$DEBT_STANDARD_PIN" ] || fail "Debt standard is at $pin, expected $DEBT_STANDARD_PIN. See the comment in ops/build.sh."

step "venue  (solc 0.8.26, IR)"
forge build --sizes

step "instruments  (solc 0.8.34, legacy, debt standard $DEBT_STANDARD_PIN)"
( cd instruments && forge build --sizes )

printf '\n\033[1mBoth units build and every contract is within EIP-170.\033[0m\n'
