#!/usr/bin/env python3
"""Verifies a public deployment's contracts on the chain's explorer (ADR 0113).

    NETWORK_FILE=ops/networks/ethereum-sepolia.json KEYS=ops/keys.ethereum-sepolia.env \\
      python3 ops/verify-contracts.py

Every contract the deploy scripts created, as forge's broadcast records list them, is verified from
its own compilation unit (instruments/ with solc 0.8.30, or the repository root with 0.8.26 and the
IR pipeline), so the compiler and its settings are the ones that built it. Constructor arguments are
read back from the creation transaction. A contract the explorer already shows verified is skipped.
Needs ETHERSCAN_API_KEY in the key file. Prints one line per contract; never prints a key.
"""
import glob, json, os, re, shutil, subprocess, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FORGE = shutil.which("forge") or os.path.expanduser("~/.foundry/bin/forge")
CAST = shutil.which("cast") or os.path.expanduser("~/.foundry/bin/cast")


def keys(path):
    out = {}
    for line in open(path):
        m = re.match(r"export (\w+)=(.*)", line.strip())
        if m:
            out[m.group(1)] = m.group(2).strip().strip('"')
    return out


def artifact_index(unit):
    """contract name -> (source path, artifact), from the unit's build output."""
    index = {}
    for f in glob.glob(os.path.join(ROOT, unit, "out", "**", "*.json"), recursive=True):
        try:
            j = json.load(open(f))
        except Exception:
            continue
        target = (j.get("metadata") or {}).get("settings", {}).get("compilationTarget") or {}
        for path, name in target.items():
            # A deployed contract's source, before a test's or a script's of the same name.
            rank = 1 if path.startswith(("test/", "script/")) else 0
            if name not in index or rank < index[name][2]:
                index[name] = (path, j, rank)
    return {n: (p, j) for n, (p, j, _) in index.items()}


def created(unit):
    """Every contract a broadcast in this unit created: (name, address, transaction hash)."""
    out = []
    for f in sorted(glob.glob(os.path.join(ROOT, unit, "broadcast", "*", str(CHAIN), "run-latest.json"))):
        d = json.load(open(f))
        hashes = {r["transactionHash"] for r in d.get("receipts", [])}
        for t in d["transactions"]:
            if t.get("hash") not in hashes:
                continue
            if t.get("transactionType") in ("CREATE", "CREATE2") and t.get("contractAddress") and t.get("contractName"):
                out.append((t["contractName"], t["contractAddress"], t["hash"], t.get("transactionType")))
    return out


def verified(address):
    """Whether the explorer already holds this address's source."""
    import urllib.request
    url = f"https://api.etherscan.io/v2/api?chainid={CHAIN}&module=contract&action=getsourcecode&address={address}&apikey={KEY}"
    try:
        r = json.loads(urllib.request.urlopen(url, timeout=30).read())
        return bool(r.get("result") and r["result"][0].get("SourceCode"))
    except Exception:
        return False


def constructor_args(tx_hash, bytecode):
    """The creation input after the creation code: the ABI-encoded constructor arguments."""
    data = subprocess.check_output([CAST, "tx", tx_hash, "input", "--rpc-url", RPC], text=True).strip()
    code = bytecode[2:] if bytecode.startswith("0x") else bytecode
    body = data[2:]
    # A CREATE2 through the deterministic deployer carries a 32-byte salt first.
    for start in (0, 64):
        if body[start:start + len(code)] == code:
            return "0x" + body[start + len(code):]
    # Libraries are linked into the deployed code: compare up to the first placeholder.
    head = code.split("__")[0]
    for start in (0, 64):
        if head and body[start:start + len(head)] == head:
            return "0x" + body[start + len(code):]
    return None


def verify(unit, name, address, tx_hash, index):
    if name not in index:
        return "no artifact"
    path, art = index[name]
    args = constructor_args(tx_hash, art["bytecode"]["object"])
    cmd = [FORGE, "verify-contract", address, f"{path}:{name}", "--chain", str(CHAIN), "--etherscan-api-key", KEY, "--watch"]
    if args is None:
        cmd += ["--guess-constructor-args", "--rpc-url", RPC]
    elif args != "0x":
        cmd += ["--constructor-args", args]
    r = subprocess.run(cmd, cwd=os.path.join(ROOT, unit), capture_output=True, text=True)
    text = (r.stdout + r.stderr).replace(KEY, "<key>")
    if "Pass - Verified" in text or "successfully verified" in text.lower():
        return "verified"
    if "already verified" in text.lower():
        return "already verified"
    last = [l for l in text.strip().splitlines() if l.strip()][-3:]
    return "FAILED: " + " | ".join(last)[:300]


# T-REX's factory deploys through a 21-byte stub that creates whatever code it is sent (CREATE3): raw
# bytecode with no source to publish.
STUB = "0x365f5f37365f34f03d5f5f3e5f3d91601357fd5bf3"


def rpc(method, params):
    import urllib.request
    req = urllib.request.Request(RPC, data=json.dumps({"jsonrpc": "2.0", "id": 1, "method": method, "params": params}).encode(), headers={"Content-Type": "application/json"})
    r = json.loads(urllib.request.urlopen(req, timeout=600).read())
    if "error" in r:
        raise RuntimeError(r["error"].get("message", "rpc error"))
    return r["result"]


def creations(tx_hash):
    """Every contract a transaction created, with its creation input, from a call trace."""
    out = []
    def walk(c):
        if c.get("type") in ("CREATE", "CREATE2") and c.get("to") and not c.get("error"):
            out.append((c["to"], c.get("input", "0x")))
        for sub in c.get("calls") or []:
            walk(sub)
    walk(rpc("debug_traceTransaction", [tx_hash, {"tracer": "callTracer"}]))
    return out


def internal_transactions():
    """Transactions that create contracts the deploy records do not name: the deployment's own, each
    note's issuance, and every transaction of the identity and custody factories."""
    txs = set()
    for unit in ("instruments", "."):
        for f in glob.glob(os.path.join(ROOT, unit, "broadcast", "*", str(CHAIN), "run-latest.json")):
            txs |= {r["transactionHash"] for r in json.load(open(f)).get("receipts", [])}
    m = json.load(open(os.path.join(ROOT, os.environ.get("MANIFEST", f"ops/addresses.{os.path.basename(os.environ['NETWORK_FILE'])[:-5]}.json"))))
    sources = [m["identity"]["noteFactory"], m["identity"]["idFactory"]]
    custody = m.get("custody") or {}
    sources += [c["factory"] for c in (custody, custody.get("thirdParty") or {}) if c.get("factory")]
    head = int(rpc("eth_blockNumber", []), 16)
    first = min(int(r["blockNumber"], 16) for f in glob.glob(os.path.join(ROOT, "instruments", "broadcast", "*", str(CHAIN), "run-latest.json")) for r in json.load(open(f)).get("receipts", []))
    for address in sources:
        for log in rpc("eth_getLogs", [{"address": address, "fromBlock": hex(first), "toBlock": hex(head)}]):
            txs.add(log["transactionHash"])
    return sorted(txs)


def match(input_hex, indexes):
    """The artifact whose creation code the input starts with, and the constructor arguments after it."""
    body = input_hex[2:].lower()
    best = None
    for unit, index in indexes:
        for name, (path, art) in index.items():
            code = (art.get("bytecode") or {}).get("object", "")[2:].lower()
            if len(code) > 40 and "__" not in code and body.startswith(code) and (best is None or len(code) > len(best[3])):
                best = (unit, name, path, code)
    if not best:
        return None
    unit, name, path, code = best
    return unit, name, path, "0x" + body[len(code):]


def verify_with(unit, name, path, address, args):
    cmd = [FORGE, "verify-contract", address, f"{path}:{name}", "--chain", str(CHAIN), "--etherscan-api-key", KEY, "--watch"]
    if args and args != "0x":
        cmd += ["--constructor-args", args]
    r = subprocess.run(cmd, cwd=os.path.join(ROOT, unit), capture_output=True, text=True)
    text = (r.stdout + r.stderr).replace(KEY, "<key>")
    if "Pass - Verified" in text or "successfully verified" in text.lower():
        return "verified"
    if "already verified" in text.lower():
        return "already verified"
    last = [l for l in text.strip().splitlines() if l.strip()][-3:]
    return "FAILED: " + " | ".join(last)[:300]


if __name__ == "__main__":
    k = keys(os.path.join(ROOT, os.environ["KEYS"]))
    KEY = k.get("ETHERSCAN_API_KEY") or sys.exit("ETHERSCAN_API_KEY is not in the key file")
    net = json.load(open(os.path.join(ROOT, os.environ["NETWORK_FILE"])))
    RPC, CHAIN = net["rpcUrl"], net["chainId"]
    results = []
    for unit in ("instruments", "."):
        index = artifact_index(unit)
        for name, address, tx, kind in created(unit):
            status = "already verified" if verified(address) else verify(unit, name, address, tx, index)
            results.append((status, name, address))
            print(f"{status[:10]:10s} {name:34s} {address}  {status if status.startswith('FAILED') else ''}", flush=True)
        # Contracts created inside transactions: named and their arguments recovered from call traces.
    indexes = [(u, artifact_index(u)) for u in ("instruments", ".")]
    seen = {a.lower() for _, _, a in results}
    for tx in internal_transactions():
        try:
            made = creations(tx)
        except Exception as e:
            results.append((f"FAILED: trace of {tx}: {e}", "(trace)", tx))
            print(f"FAILED     trace of {tx}: {e}", flush=True)
            continue
        for address, data in made:
            if address.lower() in seen:
                continue
            seen.add(address.lower())
            if rpc("eth_getCode", [address, "latest"]).lower() == STUB:
                status, name = "stub", "(deployment stub, no source)"
            elif verified(address):
                status, name = "already verified", "(matched)"
            else:
                found = match(data, indexes)
                if not found:
                    status, name = "no artifact", "(unknown)"
                else:
                    unit, name, path, args = found
                    status = verify_with(unit, name, path, address, args)
            results.append((status, name, address))
            print(f"{status[:10]:10s} {name:34s} {address}  {status if status.startswith('FAILED') else ''}", flush=True)
    failed = [r for r in results if r[0].startswith("FAILED") or r[0] == "no artifact"]
    stubs = sum(1 for r in results if r[0] == "stub")
    print(f"\n{len(results) - len(failed) - stubs} verified, {stubs} deployment stubs with no source, {len(failed)} not verified, of {len(results)} contracts")
    sys.exit(1 if failed else 0)
