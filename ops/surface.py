#!/usr/bin/env python3
"""Defines and checks the instruments' frozen contract surface (ADR 0026).

A surface file lists every in-scope source file with its SHA-256, the SHA-256 of each deployable
contract's runtime code as compiled, the compiler settings, and the debt standard's pin. It is
what an assurance review is performed against.

  python3 ops/surface.py write instruments/surface/rc1.json    # record the current tree
  python3 ops/surface.py check instruments/surface/rc1.json    # confirm a tree matches it

Both rebuild the instruments unit from clean first, so the runtime code is never read from a
stale cache. Standard library only.
"""

from __future__ import annotations

import hashlib
import json
import pathlib
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
UNIT = ROOT / "instruments"
DEPLOYABLE = [
    "IdentityRegistry", "InstrumentGate", "StructuredNote", "TokenizedDeposit", "DepositGateway",
    "DeterminationAgent", "RecordDateEngine", "PayingAgent", "DvPSettlement", "GovernanceController",
]


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def settings() -> dict:
    text = (UNIT / "foundry.toml").read_text()
    default = text.split("[profile.fork]")[0]
    keep = ("solc_version", "evm_version", "via_ir", "optimizer ", "optimizer_runs", "bytecode_hash")
    return {
        line.split("=")[0].strip(): line.split("=", 1)[1].split("#")[0].strip().strip('"')
        for line in default.splitlines()
        if line.strip().startswith(keep)
    }


def current() -> dict:
    subprocess.run(["forge", "build", "--force"], cwd=UNIT, check=True, capture_output=True)
    sources = {
        str(p.relative_to(ROOT)): sha256(p.read_bytes()) for p in sorted((UNIT / "src").rglob("*.sol"))
    }
    runtime = {}
    for name in DEPLOYABLE:
        art = json.loads((UNIT / "out" / f"{name}.sol" / f"{name}.json").read_text())
        code = art["deployedBytecode"]["object"].removeprefix("0x")
        runtime[name] = {"bytes": len(code) // 2, "sha256": sha256(bytes.fromhex(code))}
    pin = subprocess.run(
        ["git", "-C", str(UNIT / "lib" / "debt-standard"), "describe", "--tags", "--exact-match"],
        capture_output=True, text=True,
    ).stdout.strip()
    commit = subprocess.run(
        ["git", "-C", str(UNIT / "lib" / "debt-standard"), "rev-parse", "HEAD"], capture_output=True, text=True
    ).stdout.strip()
    return {
        "compiler": settings(),
        "debtStandard": {"tag": pin, "commit": commit},
        "sources": sources,
        "runtime": runtime,
    }


def main() -> None:
    mode, path = sys.argv[1], ROOT / sys.argv[2]
    now = current()
    if mode == "write":
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(now, indent=1, sort_keys=True) + "\n")
        print(f"recorded {len(now['sources'])} sources and {len(now['runtime'])} contracts in {path.relative_to(ROOT)}")
        return
    recorded = json.loads(path.read_text())
    diffs = []
    for section in ("compiler", "debtStandard", "sources", "runtime"):
        a, b = recorded[section], now[section]
        for key in sorted(set(a) | set(b)):
            if a.get(key) != b.get(key):
                diffs.append(f"{section}: {key}: recorded {a.get(key)!r}, now {b.get(key)!r}")
    if diffs:
        print("the tree differs from the surface:\n  " + "\n  ".join(diffs))
        sys.exit(1)
    print(f"the tree matches {path.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
