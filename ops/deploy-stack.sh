#!/usr/bin/env bash
# Deploys the whole stack onto an already-running chain, in dependency order.
#
# The order cannot be changed:
#   - the stand-ins exist before the venue can wrap the asset and register it with the checker
#   - the adapter holds a balance before the factory can verify it, which the pool needs
#   - the router and position manager exist before custody accounts can approve them
#   - custody accounts exist before the Access Issuer can onboard them to the instruments
set -euo pipefail
export PATH="$HOME/.foundry/bin:$PATH"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
source ./ops/keys.env

RPC="${RPC:-http://127.0.0.1:8545}"
FS="--rpc-url $RPC --broadcast"

step() { printf '\n\033[1m── %s\033[0m\n' "$1"; }

step "Permit2 and the multi-signature wallet at their canonical addresses"
RPC="$RPC" ./ops/setup-permit2.sh
RPC="$RPC" ./ops/setup-multisig.sh

step "stand-in asset and cash leg"
forge script script/00_DeployStandIns.s.sol:DeployStandIns $FS >/dev/null

step "venue"
forge script script/01_DeployVenue.s.sol:DeployVenue $FS >/dev/null

step "adapter verified, pool opened and seeded"
forge script script/02_ActivateVenue.s.sol:ActivateVenue $FS >/dev/null
forge script script/03_DeployLens.s.sol:DeployLens $FS >/dev/null

step "Custodian and segregated client accounts"
forge script script/04_DeployCustody.s.sol:DeployCustody $FS >/dev/null

step "instruments: registry, gates, note, deposit, gateway  (solc 0.8.34)"
( cd instruments && forge script script/DeployInstruments.s.sol:DeployInstruments $FS >/dev/null )

step "issuance: terms fixed, lifecycle attached, units placed by DvP"
( cd instruments && forge script script/IssueNote.s.sol:IssueNote $FS >/dev/null )

step "governance ceremony: wallets, controller, roles moved, deployer renounces"
( cd instruments && forge script script/Ceremony.s.sol:Ceremony $FS >/dev/null )
