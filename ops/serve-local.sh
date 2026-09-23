#!/usr/bin/env bash
# Connects the hosted console to the chain on THIS machine, via a Cloudflare quick tunnel.
#
# Why this exists: Vercel cannot run anvil, and the alternative (ops/deploy-chain.sh) needs a
# Fly.io login. A quick tunnel needs no account at all, so the browser console can be live in
# about a minute.
#
# Trade-off: the tunnel lives only as long as this script runs, and the URL changes each time.
# Good for showing the console from any device today; use ops/deploy-chain.sh for something
# laptop-independent.
set -euo pipefail
export PATH="/opt/homebrew/bin:$HOME/.foundry/bin:/usr/bin:/bin:$PATH"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

STATE="ops/anvil-state.json"
TUNNEL_LOG=/tmp/cloudflared-apac.log
step() { printf '\n\033[1m── %s\033[0m\n' "$1"; }
fail() { printf '\n\033[31m%s\033[0m\n' "$1" >&2; exit 1; }

command -v cloudflared >/dev/null || fail "cloudflared not installed. Run: brew install cloudflared"
[ -s "$STATE" ] || fail "No chain snapshot. Run: ./ops/bake-state.sh"

step "starting the chain from the baked snapshot"
pkill -f "anvil --chain-id 31337" 2>/dev/null || true
sleep 1
nohup anvil --chain-id 31337 \
  --host 127.0.0.1 --load-state "$STATE" --silent > /tmp/anvil-apac.log 2>&1 &
for _ in $(seq 1 40); do
  cast block-number --rpc-url http://127.0.0.1:8545 >/dev/null 2>&1 && break
  sleep 0.5
done
TOKEN="$(python3 -c "import json;print(json.load(open('ops/addresses.json'))['trex']['token'])")"
SUPPLY="$(cast call "$TOKEN" 'totalSupply()(uint256)' --rpc-url http://127.0.0.1:8545 | awk '{print $1}')"
[ -n "$SUPPLY" ] && [ "$SUPPLY" != "0" ] || fail "Chain started but the snapshot did not restore."
echo "   chain up, snapshot restored"

step "opening a public tunnel to it"
pkill -f "cloudflared tunnel" 2>/dev/null || true
sleep 1
rm -f "$TUNNEL_LOG"
# --protocol http2 matters: cloudflared defaults to QUIC (UDP), which some networks mangle —
# the tunnel then registers but flaps forever ("failed to serve tunnel connection" on repeat)
# and the hosted console hangs on every chain read. TCP-based http2 survives those networks.
nohup cloudflared tunnel --no-autoupdate --protocol http2 --url http://127.0.0.1:8545 > "$TUNNEL_LOG" 2>&1 &

URL=""
for _ in $(seq 1 40); do
  URL="$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' "$TUNNEL_LOG" 2>/dev/null | head -1 || true)"
  [ -n "$URL" ] && break
  sleep 1
done
[ -n "$URL" ] || fail "Tunnel did not come up. See $TUNNEL_LOG"
echo "   $URL"

step "checking the tunnel serves JSON-RPC"
CHAIN_HEX=""
for _ in $(seq 1 15); do
  # `|| true` matters: under `set -e` a failed curl (e.g. this machine cannot resolve
  # trycloudflare.com, which the comment below already anticipates) would otherwise kill the
  # whole script here instead of falling through to the warn-and-continue path.
  CHAIN_HEX="$(curl -s --max-time 10 -X POST "$URL" -H 'Content-Type: application/json' \
    -d '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}' 2>/dev/null \
    | python3 -c "import json,sys
try: print(json.load(sys.stdin)['result'])
except Exception: print('')" || true)"
  [ -n "$CHAIN_HEX" ] && break
  sleep 2
done
if [ -z "$CHAIN_HEX" ]; then
  # Some networks cannot resolve trycloudflare.com from the same host that created the tunnel,
  # so a failed probe here does not mean the tunnel is broken — Vercel may still reach it fine.
  # Warn and carry on rather than aborting; the final check is whether the console renders.
  printf '\033[33m   could not verify the tunnel from this machine (DNS); continuing anyway\033[0m\n'
  CHAIN_ID=31337
else
  CHAIN_ID=$((CHAIN_HEX))
  echo "   chain id $CHAIN_ID over the tunnel"
fi

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
  printf '%s' "$URL"      | vercel env add RPC_URL  "$envn" >/dev/null 2>&1 || true
  printf '%s' "$CHAIN_ID" | vercel env add CHAIN_ID "$envn" >/dev/null 2>&1 || true
done
vercel deploy --prod --yes >/dev/null
cd ..
echo "   console redeployed"

printf '\n\033[1mLive.\033[0m https://apac-rwa-console.vercel.app\n'
printf '  chain tunnel: %s\n' "$URL"
printf '  keep this machine awake -- the tunnel and chain both run here.\n'
printf '  re-run this script if the tunnel drops (the URL changes each time).\n\n'
