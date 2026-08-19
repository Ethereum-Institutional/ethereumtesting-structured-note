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
nohup anvil --chain-id 31337 --code-size-limit 60000 \
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
nohup cloudflared tunnel --no-autoupdate --url http://127.0.0.1:8545 > "$TUNNEL_LOG" 2>&1 &

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
  CHAIN_HEX="$(curl -s --max-time 10 -X POST "$URL" -H 'Content-Type: application/json' \
    -d '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}' 2>/dev/null \
    | python3 -c "import json,sys
try: print(json.load(sys.stdin)['result'])
except Exception: print('')")"
  [ -n "$CHAIN_HEX" ] && break
  sleep 2
done
[ -n "$CHAIN_HEX" ] || fail "Tunnel is up but not answering eth_chainId."
CHAIN_ID=$((CHAIN_HEX))
echo "   chain id $CHAIN_ID over the tunnel"

step "pointing the Vercel console at it"
cd dashboard
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
