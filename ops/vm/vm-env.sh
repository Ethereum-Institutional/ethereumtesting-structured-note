#!/usr/bin/env bash
# Writes the settings for the site on the bank's virtual machine: ops/vm/site.env, the
# same chain settings our public site has (ops/site_env.py), the manifest beside it, and a database
# password, all readable by the owner only and excluded from git. Prints names, never values.
#
#   SITE_URL=https://notes.bank.example MAIL_FROM='Notes <notes@bank.example>' \
#   OPERATOR_EMAILS=ops@bank.example RESEND_API_KEY=... \
#     ./ops/vm/vm-env.sh ops/addresses.ethereum-sepolia.json ops/networks/ethereum-sepolia.json ops/keys.ethereum-sepolia.env
#
# Mail settings left unset are written empty, to be filled in on the VM: the site starts without
# them but cannot send a sign-in code until they are there.
set -euo pipefail
export PATH="$HOME/.foundry/bin:$PATH"
MANIFEST="${1:?manifest}"; NETWORK="${2:?network file}"; KEYS="${3:?key file}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
set -a; source "$KEYS"; set +a
export MANIFEST NETWORK HERE

umask 077
cp "$MANIFEST" "$HERE/manifest.json"
python3 - <<'PY'
import os, secrets, sys
sys.path.insert(0, os.path.join(os.environ["HERE"], ".."))
from site_env import site_env
env = site_env(os.environ["MANIFEST"], os.environ["NETWORK"], embed_manifest=False)
for k in ("SITE_URL", "MAIL_FROM", "RESEND_API_KEY", "OPERATOR_EMAILS", "BANK_EMAILS", "ONBOARDING_EMAILS",
          "AGENT_EMAILS", "CUSTODIAN_EMAILS", "AUTO_APPROVE_DOMAINS"):
    env[k] = os.environ.get(k, "")
with open(os.path.join(os.environ["HERE"], "site.env"), "w") as f:
    for k, v in env.items():
        f.write(f"{k}='{v}'\n")
    print("site.env:", ", ".join(k + ("" if v else " (empty)") for k, v in env.items()))
# compose reads the database password from .env beside it; kept on a rerun so the volume still opens.
dotenv = os.path.join(os.environ["HERE"], ".env")
if not os.path.exists(dotenv):
    open(dotenv, "w").write(f"DB_PASSWORD={secrets.token_urlsafe(24)}\n")
print(".env: DB_PASSWORD; manifest.json")
PY
