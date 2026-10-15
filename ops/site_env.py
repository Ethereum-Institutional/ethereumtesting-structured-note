"""The site's chain settings for one deployment, from its manifest, network file and key file (ADR 0098).

One list for both places the site runs: ops/vercel-env.sh sends it to Vercel, ops/vm/vm-env.sh
writes it for the bank's virtual machine. Reads the key file's capacities from the environment and
derives the ceremony wallets' owners from WALLET_MNEMONIC. Returns values; never prints them.
"""
import json, os, subprocess


def _wallet_key(index: int) -> str:
    return subprocess.check_output(
        ["cast", "wallet", "private-key", os.environ["WALLET_MNEMONIC"], str(index)], text=True
    ).strip()


def site_env(manifest_path: str, network_path: str, embed_manifest: bool) -> dict:
    e = os.environ
    net = json.load(open(network_path))
    manifest = json.load(open(manifest_path))
    env = {
        "RPC_URL": net["rpcUrl"],
        "SIGNER_KEYS": json.dumps({
            # The onboarding agent, the bank (as Deposit Agent), its custody platform, and a third-party custodian (ADR 0089).
            "accessIssuer": e["ACCESS_ISSUER_PK"], "depositAgent": e["DEPOSIT_AGENT_PK"],
            "custodian": e["CUSTODIAN_PK"], "thirdPartyCustodian": e["THIRD_PARTY_CUSTODIAN_PK"],
            # The demonstration notes' roles (ADR 0072).
            "issuer": e["ISSUER_PK"], "agent": e["AGENT_PK"], "calculationAgent": e["CALCULATION_AGENT_PK"],
            # Two owners of the Agent's 2-of-3 servicing wallet, which pays (ADR 0072): mnemonic indices 19 and 20.
            "servicing1": _wallet_key(19), "servicing2": _wallet_key(20),
            # Two owners of each institution's 2-of-3 governance wallet (ADR 0082): the Agent's (10, 11),
            # the Issuer's (13, 14) and the co-signing institution's (16, 17).
            "agentGov1": _wallet_key(10), "agentGov2": _wallet_key(11),
            "issuerGov1": _wallet_key(13), "issuerGov2": _wallet_key(14),
            "cosigner1": _wallet_key(16), "cosigner2": _wallet_key(17),
        }),
    }
    if embed_manifest:
        env["MANIFEST_JSON"] = json.dumps(manifest, separators=(",", ":"))
    # The Ledger reads history through Alchemy, whose log queries take the whole range (ADR 0071).
    alchemy = {84532: "base-sepolia", 8453: "base-mainnet", 11155111: "eth-sepolia"}
    if e.get("ALCHEMY_API_KEY") and manifest["chainId"] in alchemy:
        env["LEDGER_RPC_URL"] = f"https://{alchemy[manifest['chainId']]}.g.alchemy.com/v2/{e['ALCHEMY_API_KEY']}"
    return env
