#!/usr/bin/env bash
# Deploys the whole stack onto an already-running chain, in dependency order.
#
# The order cannot be changed:
#   - the scaffolding (identities, T-REX, claim issuers, the deposit) exists before any note
#   - the deposit exists before the venue can wrap it in its adapter (ADR 0038)
#   - the adapter holds a balance before the factory can verify it, which the pool needs
#   - the router and position manager exist before custody accounts can approve them
#   - the ceremony moves every role, the venue's included, so it comes last
#
# The conversion pool is deployed by default, gated on the same ONCHAINID identities (ADR 0090):
# POOL=0 leaves it out.
#
# On a fork of a public network (ops/dry-run-fork.sh) nothing is installed: Permit2 and the wallet
# are already deployed there. Set PUBLIC_NETWORK=1 and NETWORK_FILE.
set -euo pipefail
export PATH="$HOME/.foundry/bin:$PATH"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
# KEYS names the key file; the local node's published keys by default (ADR 0051).
source "${KEYS:-./ops/keys.env}"

RPC="${RPC:-http://127.0.0.1:8545}"
# On a live network, broadcast one transaction at a time and wait for each (FORGE_FLAGS="--slow").
FS="--rpc-url $RPC --broadcast ${FORGE_FLAGS:-}"

step() { printf '\n\033[1m── %s\033[0m\n' "$1"; }

# Forge's incremental build can keep a script's embedded creation code after a contract it
# deploys has changed, so a deployment would run the old contract (HANDOFF section 5). A forced
# build of both units costs seconds and rules that out.
step "forced build of both compilation units"
forge build --force >/dev/null 2>&1 || forge build --force
( cd instruments && forge soldeer install >/dev/null && { forge build --force >/dev/null 2>&1 || forge build --force; } )

if [ "${PUBLIC_NETWORK:-0}" != 1 ]; then
  step "Permit2 and the multi-signature wallet at their canonical addresses"
  RPC="$RPC" ./ops/setup-permit2.sh
  RPC="$RPC" ./ops/setup-multisig.sh
fi

step "parties and the payment token"
forge script script/00_DeployBase.s.sol:DeployBase $FS >/dev/null

step "scaffolding: identities, T-REX, claim issuers, deposit, gateway; the cast onboarded by role  (solc 0.8.30)"
( cd instruments && forge script script/DeployInstruments.s.sol:DeployInstruments $FS >/dev/null )

if [ "${POOL:-1}" = 1 ]; then
  step "the conversion pool: venue around the deposit, gated on the pool's identity registry"
  forge script script/01_DeployVenue.s.sol:DeployVenue $FS >/dev/null
  step "adapter verified, pool opened at par, cast admitted by pool-access claim, liquidity provided"
  forge script script/02_ActivateVenue.s.sol:ActivateVenue $FS >/dev/null
  forge script script/03_DeployLens.s.sol:DeployLens $FS >/dev/null
fi

step "custodians and segregated client accounts, onboarded by role"
forge script script/04_DeployCustody.s.sol:DeployCustody $FS >/dev/null

step "the term sheet: the record the note is issued from, dated from the chain's clock (ADR 0095)"
( cd site && RPC="$RPC" node scripts/term-sheet.ts )

step "issuance: the note from its term sheet, through the note factory, units placed by locked offer"
( cd instruments && forge script script/IssueNote.s.sol:IssueNote $FS >/dev/null )
# The record goes into the manifest, so the site can publish it at the address the note carries.
M="${MANIFEST:-ops/addresses.json}"
jq --slurpfile t "${TERM_SHEET_FILE:-ops/term-sheet.json}" '.termSheet = $t[0].record' "$M" > "$M.tmp" && mv "$M.tmp" "$M"

step "governance ceremony: wallets, controller, ownership and roles moved, deployer renounces"
( cd instruments && forge script script/Ceremony.s.sol:Ceremony $FS >/dev/null )
