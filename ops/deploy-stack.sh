#!/usr/bin/env bash
# Deploys the whole stack onto an already-running chain, in dependency order.
#
# The order cannot be changed:
#   - the payment token and the credential protocol exist before anything refers to them
#   - the deposit exists before the venue can wrap it in its adapter (ADR 0038)
#   - the adapter holds a balance before the factory can verify it, which the pool needs
#   - the router and position manager exist before custody accounts can approve them
#   - the ceremony moves every role, the venue's included, so it comes last
#
# On a fork of a public network (ops/dry-run-fork.sh) nothing is installed: Permit2, the wallet
# and the credential protocol are already deployed there. Set PUBLIC_NETWORK=1 and NETWORK_FILE.
set -euo pipefail
export PATH="$HOME/.foundry/bin:$PATH"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
source ./ops/keys.env

RPC="${RPC:-http://127.0.0.1:8545}"
FS="--rpc-url $RPC --broadcast"

step() { printf '\n\033[1m── %s\033[0m\n' "$1"; }

# Forge's incremental build can keep a script's embedded creation code after a contract it
# deploys has changed, so a deployment would run the old contract (HANDOFF section 5). A forced
# build of both units costs seconds and rules that out.
step "forced build of both compilation units"
forge build --force >/dev/null 2>&1 || forge build --force
( cd instruments && { forge build --force >/dev/null 2>&1 || forge build --force; } )

if [ "${PUBLIC_NETWORK:-0}" != 1 ]; then
  step "Permit2, the multi-signature wallet and the credential protocol at their canonical addresses"
  RPC="$RPC" ./ops/setup-permit2.sh
  RPC="$RPC" ./ops/setup-multisig.sh
  RPC="$RPC" ./ops/setup-credential-protocol.sh
fi

step "payment token and credential protocol"
forge script script/00_DeployBase.s.sol:DeployBase $FS >/dev/null

step "instruments: registry, gates, note, deposit, gateway  (solc 0.8.34)"
( cd instruments && forge script script/DeployInstruments.s.sol:DeployInstruments $FS >/dev/null )

step "venue around the deposit, with the pool's credential gate"
forge script script/01_DeployVenue.s.sol:DeployVenue $FS >/dev/null

step "adapter verified, pool opened at par, cast admitted, liquidity provided"
forge script script/02_ActivateVenue.s.sol:ActivateVenue $FS >/dev/null
forge script script/03_DeployLens.s.sol:DeployLens $FS >/dev/null

step "Custodian and segregated client accounts"
forge script script/04_DeployCustody.s.sol:DeployCustody $FS >/dev/null

step "issuance: terms fixed, lifecycle attached, units placed by DvP"
( cd instruments && forge script script/IssueNote.s.sol:IssueNote $FS >/dev/null )

step "governance ceremony: wallets, controller, roles moved, venue handed over, deployer renounces"
( cd instruments && forge script script/Ceremony.s.sol:Ceremony $FS >/dev/null )
