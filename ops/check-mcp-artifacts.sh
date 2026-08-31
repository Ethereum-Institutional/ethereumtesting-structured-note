#!/usr/bin/env bash
# The /build page claims its code samples are verbatim MCP output. This guards that claim by
# checking the copy the page renders is byte-identical to the one that actually compiles.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
A="$ROOT/mcp-token/contracts/APACMoneyMarket.sol"
B="$ROOT/dashboard/content/mcp/rwa-token.sol"
if diff -q "$A" "$B" >/dev/null; then
  echo "ok: rendered MCP token matches the compiled one"
else
  echo "DRIFT between:" >&2; echo "  $A" >&2; echo "  $B" >&2
  diff "$A" "$B" >&2 || true
  exit 1
fi
