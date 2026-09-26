#!/usr/bin/env bash
# Sets the site's admission settings on its Vercel project (ADRs 0045 to 0054), for a deployment
# described by a manifest, a network file and a key file. Every value is read from those files and
# sent straight to Vercel as a production variable of type sensitive, which this team requires, so
# no secret passes through a terminal or a transcript. Prints the names it set, never the values.
#
#   ./ops/vercel-admission-env.sh ops/addresses.base-sepolia.json ops/networks/base-sepolia.json \
#     ops/keys.base-sepolia-integration.env
#
# Then redeploy the site so a new build picks them up.
set -euo pipefail
MANIFEST="${1:?manifest}"; NETWORK="${2:?network file}"; KEYS="${3:?key file}"
PROJECT="${VERCEL_PROJECT:-prj_no72yrJMpHlauyF15PSEVfTUi71Y}"
TEAM="${VERCEL_TEAM:-team_ZL9r7lekuStIElkLskhD8X3t}"
AUTH="$HOME/Library/Application Support/com.vercel.cli/auth.json"

set -a; source "$KEYS"; set +a
export MANIFEST NETWORK
export VERCEL_TOKEN="$(python3 -c "import json;print(json.load(open('$AUTH'))['token'])")"

python3 - "$PROJECT" "$TEAM" <<'PY'
import json, os, sys, urllib.request
project, team = sys.argv[1], sys.argv[2]
net = json.load(open(os.environ["NETWORK"]))
adm = net["admission"]
bank_key = json.load(open(adm["bankIssuerKeyFile"]))
env = {
    "MANIFEST_JSON": json.dumps(json.load(open(os.environ["MANIFEST"])), separators=(",", ":")),
    "RPC_URL": net["rpcUrl"],
    "SIGNER_KEYS": json.dumps({"accessIssuer": os.environ["ACCESS_ISSUER_PK"], "custodian": os.environ["CUSTODIAN_PK"]}),
    "ADMISSION_ISSUER_DID": net["credentialProtocol"]["issuerDid"],
    "ADMISSION_ISSUER_PUBKEY": bank_key["mlDsaPubkey"],
    "ADMISSION_SCHEMAS": json.dumps({k: net["schemas"][k] for k in ("officer", "walletControl", "corporateIdentity")}),
    "ADMISSION_CORPORATE_ISSUERS": json.dumps(adm["corporateIssuers"]),
    "CREDENTIAL_VERIFIER_URL": adm["credentialVerifierUrl"],
    "ADMISSION_VERIFIER_DID": adm["verifierDid"],
    "ADMISSION_VERIFIER_NAME": adm["verifierName"],
    "ADMISSION_VERIFIER_SEED": os.environ["ADMISSION_VERIFIER_SEED"],
    "ADMISSION_VERIFIER_INLINE_KEY": "1",  # self-signed: no registration with the protocol needed
}
for k in ("BANK_ISSUER_URL", "BANK_ISSUER_TOKEN"):
    if os.environ.get(k):
        env[k] = os.environ[k]
missing = [k for k in ("BANK_ISSUER_URL", "BANK_ISSUER_TOKEN") if k not in env]
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
if missing:
    print("not set yet (store the bank operator token first): " + ", ".join(missing))
PY
