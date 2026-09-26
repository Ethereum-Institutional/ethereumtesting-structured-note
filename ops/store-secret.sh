#!/usr/bin/env bash
# Stores a secret in a key file without it passing through a terminal, a clipboard or a
# transcript: a hidden macOS dialog asks for it, and it is appended as an export line. Any earlier
# line for the same name is replaced.
#
#   ./ops/store-secret.sh BANK_ISSUER_TOKEN ops/keys.base-sepolia-integration.env
set -euo pipefail
NAME="${1:?name}"; FILE="${2:?key file}"
[[ "$NAME" =~ ^[A-Z_][A-Z0-9_]*$ ]] || { echo "not a variable name: $NAME" >&2; exit 1; }
VALUE="$(osascript -e "text returned of (display dialog \"Paste the value for $NAME\" default answer \"\" with hidden answer buttons {\"Cancel\", \"Store\"} default button \"Store\")")"
VALUE="${VALUE//[$'\r\n']/}"
# Tolerate what copying from JSON or a header tends to bring along: quotes, "Bearer ", whitespace.
VALUE="$(printf '%s' "$VALUE" | sed -E 's/^[[:space:]]+//; s/[[:space:]]+$//; s/^[Bb]earer[[:space:]]+//; s/^["'"'"'`]//; s/["'"'"'`,]$//')"
[ -n "$VALUE" ] || { echo "nothing entered" >&2; exit 1; }
[[ "$VALUE" != *" "* ]] || { echo "the value contains spaces; was the right thing copied?" >&2; exit 1; }
if [ -n "${EXPECT_PREFIX:-}" ] && [[ "$VALUE" != "$EXPECT_PREFIX"* ]]; then
  echo "the value does not start with $EXPECT_PREFIX (it starts with '${VALUE:0:2}', ${#VALUE} characters); nothing stored" >&2; exit 1
fi
touch "$FILE"; chmod 600 "$FILE"
grep -v "^export $NAME=" "$FILE" > "$FILE.new" || true
printf 'export %s=%s\n' "$NAME" "$VALUE" >> "$FILE.new"
mv "$FILE.new" "$FILE"; chmod 600 "$FILE"
echo "stored $NAME (${#VALUE} characters)"
