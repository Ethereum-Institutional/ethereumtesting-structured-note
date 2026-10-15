#!/usr/bin/env bash
# Sets the site's chain settings on its Vercel project, for a deployment described by a manifest, a
# network file and a key file: the manifest, the RPC, and the keys the site signs with, capacity by
# capacity. Every value is read from those files and sent straight to Vercel as a production
# variable of type sensitive, which this team requires, so no secret passes through a terminal or a
# transcript. Prints the names it set, never the values.
#
# Onboarding rests on ERC-3643 identities and claims (ADRs 0088, 0089): the external credential
# platform's settings are removed from the project, not set.
#
#   ./ops/vercel-env.sh ops/addresses.sepolia.json ops/networks/sepolia.json ops/keys.sepolia.env
#
# Then redeploy the site so a new build picks them up.
set -euo pipefail
MANIFEST="${1:?manifest}"; NETWORK="${2:?network file}"; KEYS="${3:?key file}"
PROJECT="${VERCEL_PROJECT:-prj_no72yrJMpHlauyF15PSEVfTUi71Y}"
TEAM="${VERCEL_TEAM:-team_ZL9r7lekuStIElkLskhD8X3t}"
AUTH="$HOME/Library/Application Support/com.vercel.cli/auth.json"

set -a; source "$KEYS"; set +a
export MANIFEST NETWORK
export ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# The CLI's saved login expires after some hours; any CLI command renews it before it is read.
npx --yes vercel whoami >/dev/null 2>&1 || { echo "Vercel CLI login failed: run 'npx vercel login'" >&2; exit 1; }
export VERCEL_TOKEN="$(python3 -c "import json;print(json.load(open('$AUTH'))['token'])")"

python3 - "$PROJECT" "$TEAM" <<'PY'
import json, os, sys, urllib.request
project, team = sys.argv[1], sys.argv[2]
sys.path.insert(0, os.path.join(os.environ["ROOT"], "ops"))
from site_env import site_env
env = site_env(os.environ["MANIFEST"], os.environ["NETWORK"], embed_manifest=True)
for key, value in env.items():
    body = json.dumps({"key": key, "value": value, "type": "sensitive", "target": ["production"]}).encode()
    req = urllib.request.Request(
        f"https://api.vercel.com/v10/projects/{project}/env?teamId={team}&upsert=true",
        data=body, method="POST",
        headers={"Authorization": f"Bearer {os.environ['VERCEL_TOKEN']}", "Content-Type": "application/json"},
    )
    try:
        urllib.request.urlopen(req).read()
        print(f"set {key}")
    except urllib.error.HTTPError as e:
        print(f"FAILED {key}: {json.loads(e.read()).get('error', {}).get('message')}")
# The external credential platform's settings, and the staff token before them (ADR 0055), are
# removed from the project: nothing reads them since 0.2.0 (ADR 0089).
RETIRED = {
    "BANK_ISSUER_TOKEN", "BANK_ISSUER_URL", "BANK_ISSUER_API_KEY", "CREDENTIAL_VERIFIER_URL",
    "ADMISSION_ISSUER_DID", "ADMISSION_ISSUER_PUBKEY", "ADMISSION_SCHEMAS", "ADMISSION_CORPORATE_ISSUERS",
    "ADMISSION_VERIFIER_DID", "ADMISSION_VERIFIER_NAME", "ADMISSION_VERIFIER_SEED", "ADMISSION_VERIFIER_INLINE_KEY",
}
listing = urllib.request.Request(f"https://api.vercel.com/v10/projects/{project}/env?teamId={team}",
                                 headers={"Authorization": f"Bearer {os.environ['VERCEL_TOKEN']}"})
for e in json.loads(urllib.request.urlopen(listing).read()).get("envs", []):
    if e.get("key") in RETIRED:
        urllib.request.urlopen(urllib.request.Request(
            f"https://api.vercel.com/v9/projects/{project}/env/{e['id']}?teamId={team}", method="DELETE",
            headers={"Authorization": f"Bearer {os.environ['VERCEL_TOKEN']}"})).read()
        print(f"removed {e['key']}")
PY
