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
# Two owners of the Agent's 2-of-3 servicing wallet, which pays (ADR 0072): mnemonic indices 19 and 20 (Ceremony).
export SERVICING1_PK="$(cast wallet private-key "$WALLET_MNEMONIC" 19)"
export SERVICING2_PK="$(cast wallet private-key "$WALLET_MNEMONIC" 20)"
# Two owners of each institution's 2-of-3 governance wallet (ADR 0082): the Agent's (10, 11), the
# Issuer's (13, 14) and the co-signing institution's (16, 17).
export AGENT_GOV1_PK="$(cast wallet private-key "$WALLET_MNEMONIC" 10)"
export AGENT_GOV2_PK="$(cast wallet private-key "$WALLET_MNEMONIC" 11)"
export ISSUER_GOV1_PK="$(cast wallet private-key "$WALLET_MNEMONIC" 13)"
export ISSUER_GOV2_PK="$(cast wallet private-key "$WALLET_MNEMONIC" 14)"
export COSIGNER1_PK="$(cast wallet private-key "$WALLET_MNEMONIC" 16)"
export COSIGNER2_PK="$(cast wallet private-key "$WALLET_MNEMONIC" 17)"
export MANIFEST NETWORK
# The CLI's saved login expires after some hours; any CLI command renews it before it is read.
npx --yes vercel whoami >/dev/null 2>&1 || { echo "Vercel CLI login failed: run 'npx vercel login'" >&2; exit 1; }
export VERCEL_TOKEN="$(python3 -c "import json;print(json.load(open('$AUTH'))['token'])")"

python3 - "$PROJECT" "$TEAM" <<'PY'
import json, os, sys, urllib.request
project, team = sys.argv[1], sys.argv[2]
net = json.load(open(os.environ["NETWORK"]))
env = {
    "MANIFEST_JSON": json.dumps(json.load(open(os.environ["MANIFEST"])), separators=(",", ":")),
    "RPC_URL": net["rpcUrl"],
    "SIGNER_KEYS": json.dumps({
        # The onboarding agent, the bank (as Deposit Agent), its custody platform, and a third-party custodian (ADR 0089).
        "accessIssuer": os.environ["ACCESS_ISSUER_PK"], "depositAgent": os.environ["DEPOSIT_AGENT_PK"],
        "custodian": os.environ["CUSTODIAN_PK"], "thirdPartyCustodian": os.environ["THIRD_PARTY_CUSTODIAN_PK"],
        # The demonstration notes' roles (ADR 0072).
        "issuer": os.environ["ISSUER_PK"], "agent": os.environ["AGENT_PK"], "calculationAgent": os.environ["CALCULATION_AGENT_PK"],
        "servicing1": os.environ["SERVICING1_PK"], "servicing2": os.environ["SERVICING2_PK"],
        "agentGov1": os.environ["AGENT_GOV1_PK"], "agentGov2": os.environ["AGENT_GOV2_PK"],
        "issuerGov1": os.environ["ISSUER_GOV1_PK"], "issuerGov2": os.environ["ISSUER_GOV2_PK"],
        "cosigner1": os.environ["COSIGNER1_PK"], "cosigner2": os.environ["COSIGNER2_PK"],
    }),
}
# The Ledger reads history through Alchemy, whose log queries take the whole range (ADR 0071).
ALCHEMY_NETWORKS = {84532: "base-sepolia", 8453: "base-mainnet", 11155111: "eth-sepolia"}
chain_id = json.load(open(os.environ["MANIFEST"]))["chainId"]
if os.environ.get("ALCHEMY_API_KEY") and chain_id in ALCHEMY_NETWORKS:
    env["LEDGER_RPC_URL"] = f"https://{ALCHEMY_NETWORKS[chain_id]}.g.alchemy.com/v2/{os.environ['ALCHEMY_API_KEY']}"
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
