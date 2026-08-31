#!/usr/bin/env bash
# Keeps the hosted console connected to the chain on this machine.
#
# Cloudflare quick tunnels are ephemeral by design — they drop on laptop sleep, network blips,
# or Cloudflare's own rotation, and every drop shows the audience "Not connected to a chain".
# This watchdog probes the DEPLOYED site end to end (can Vercel actually read the chain?) and,
# when the answer is no, re-runs ops/serve-local.sh to restart the tunnel and re-point Vercel.
#
# Runs from launchd every 5 minutes (see ops/com.oz.apac-demo-watchdog.plist). It is a stopgap:
# the durable fix is ops/deploy-chain.sh, which moves the chain to Fly.io and needs no tunnel
# at all. Once the chain runs on Fly, unload this agent.
set -uo pipefail
export PATH="/opt/homebrew/bin:$HOME/.foundry/bin:/usr/bin:/bin:/usr/sbin:$PATH"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG="/tmp/apac-demo-watchdog.log"
LOCK="/tmp/apac-demo-watchdog.lock"

log() { printf '%s %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$1" >> "$LOG"; }

# One heal at a time; a second tick during a ~2-minute heal must not stack another.
if ! mkdir "$LOCK" 2>/dev/null; then
  log "skip: heal already in progress"
  exit 0
fi
trap 'rmdir "$LOCK"' EXIT

# The probe is the deployed page itself: this marker renders only when the Vercel server
# managed a live read from the chain. Anything less (pinging the tunnel from here) lies —
# this machine sometimes cannot resolve trycloudflare.com even while Vercel reaches it fine.
MARKER="that rule answering live, right now"
BODY="$(curl -s --max-time 25 "https://apac-rwa-console.vercel.app/build" || true)"

if printf '%s' "$BODY" | grep -q "$MARKER"; then
  log "healthy"
  exit 0
fi

if [ -z "$BODY" ]; then
  # Vercel itself unreachable — likely this machine is offline. A tunnel restart cannot help.
  log "skip: cannot reach Vercel (offline?)"
  exit 0
fi

log "UNHEALTHY — hosted console cannot read the chain; re-running serve-local.sh"
if "$ROOT/ops/serve-local.sh" >> "$LOG" 2>&1; then
  log "healed"
else
  log "heal FAILED — see output above"
fi
