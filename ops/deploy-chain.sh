#!/usr/bin/env bash
# Publishes the demo chain to Fly.io and points the Vercel console at it.
#
# Prerequisite (one time, needs a browser):
#   flyctl auth login
#
# Safe to re-run: creates the app if missing, otherwise redeploys it.
set -euo pipefail
export PATH="/opt/homebrew/bin:$HOME/.foundry/bin:$PATH"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

APP="${FLY_APP:-apac-rwa-chain}"
REGION="${FLY_REGION:-sin}"
# Set FLY_ORG if your Fly account belongs to more than one organisation.
ORG="${FLY_ORG:-}"
STATE="ops/anvil-state.json"
CTX="ops/fly"

fail() { printf '\n\033[31m%s\033[0m\n' "$1" >&2; exit 1; }
step() { printf '\n\033[1m── %s\033[0m\n' "$1"; }

flyctl auth whoami >/dev/null 2>&1 || fail "Not logged in to Fly. Run: flyctl auth login"

step "chain snapshot"
if [ ! -s "$STATE" ]; then
  echo "no snapshot found, baking one"
  ./ops/bake-state.sh
fi
cp "$STATE" "$CTX/anvil-state.json"
echo "   $(du -h "$CTX/anvil-state.json" | cut -f1) snapshot staged"

step "Fly app"
# `status` is a more reliable existence probe than parsing `apps list`, whose column layout
# shifts between flyctl versions.
if flyctl status --app "$APP" >/dev/null 2>&1; then
  echo "   $APP already exists"
else
  if [ -n "$ORG" ]; then
    flyctl apps create "$APP" --org "$ORG"
  else
    flyctl apps create "$APP" \
      || fail "Could not create $APP. If your account has several organisations, set FLY_ORG (see: flyctl orgs list)."
  fi
  echo "   $APP created"
fi

step "deploying anvil (built on Fly's builders -- no local Docker needed)"
( cd "$CTX" && flyctl deploy --remote-only --app "$APP" --yes )

# Fly always serves an app at <name>.fly.dev, so derive the host rather than parsing status
# output whose JSON shape varies between versions.
RPC="https://$APP.fly.dev"

step "verifying the RPC (first boot can take ~30s)"
CHAIN_HEX=""
for _ in $(seq 1 20); do
  CHAIN_HEX="$(curl -s --max-time 10 -X POST "$RPC" \
    -H 'Content-Type: application/json' \
    -d '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}' 2>/dev/null | python3 -c "
import json,sys
try: print(json.load(sys.stdin)['result'])
except Exception: print('')
")"
  [ -n "$CHAIN_HEX" ] && break
  sleep 5
done
[ -n "$CHAIN_HEX" ] || fail "RPC at $RPC did not answer eth_chainId. Check: flyctl logs --app $APP"
CHAIN_ID=$((CHAIN_HEX))
echo "   $RPC is live, chain id $CHAIN_ID"

TOKEN="$(python3 -c "import json;print(json.load(open('ops/addresses.json'))['trex']['token'])")"
SUPPLY="$(cast call "$TOKEN" 'totalSupply()(uint256)' --rpc-url "$RPC" 2>/dev/null | awk '{print $1}')"
[ -n "$SUPPLY" ] && [ "$SUPPLY" != "0" ] || fail "State did not load: token supply is empty at $RPC"
echo "   snapshot restored, token supply $SUPPLY"

step "pointing the Vercel console at it"
cd dashboard
# The manifest travels as an environment variable, so it must be refreshed alongside the RPC URL.
# Skipping this leaves the console reading addresses from a previous build of the chain — which
# fails in confusing ways, like a treasury that exists on-chain but not to the app.
python3 -c "import json;print(json.dumps(json.load(open('../ops/addresses.json')),separators=(',',':')))" > /tmp/addresses.min.json
for envn in production preview development; do
  vercel env rm ADDRESSES_JSON "$envn" --yes >/dev/null 2>&1 || true
  vercel env add ADDRESSES_JSON "$envn" < /tmp/addresses.min.json >/dev/null 2>&1 || true
done
for envn in production preview development; do
  for var in RPC_URL CHAIN_ID; do
    vercel env rm "$var" "$envn" --yes >/dev/null 2>&1 || true
  done
  printf '%s' "$RPC"      | vercel env add RPC_URL  "$envn" >/dev/null 2>&1 || true
  printf '%s' "$CHAIN_ID" | vercel env add CHAIN_ID "$envn" >/dev/null 2>&1 || true
done
echo "   RPC_URL and CHAIN_ID set"

step "redeploying the console so it picks up the new settings"
vercel deploy --prod --yes >/dev/null
echo "   deployed"

printf '\n\033[1mDone.\033[0m\n'
printf '  console: https://apac-rwa-console.vercel.app\n'
printf '  chain:   %s  (chain id %s)\n' "$RPC" "$CHAIN_ID"
printf '  logs:    flyctl logs --app %s\n' "$APP"
printf '  reset:   flyctl apps restart %s   # reverts to the baked snapshot\n\n' "$APP"
