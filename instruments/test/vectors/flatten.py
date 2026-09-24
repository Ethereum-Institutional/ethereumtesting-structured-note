"""Flattens spikes/payoff/vectors.json into test/vectors/cases.json for the Foundry vector test.

The vectors are the independent model's output (spike 3, S-34). This script changes their
shape, not their content: it maps dates to timestamps, and states per date the outcome the
Calculation Agent would sign, taken from the model's events. The one thing the events do not
carry for every date is the worst performer on a date with no payment; that comes from the
model's own `worst`, so every figure the contract is checked against is the model's.

Run from instruments/:  python3 test/vectors/flatten.py
"""

from __future__ import annotations

import datetime as dt
import json
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "spikes" / "payoff"))

from model import Observation, Terms, TwinWin, worst  # noqa: E402

DAY = 86_400
RECORD_AFTER = 2 * DAY  # Record Time, after the observation date
PAYMENT_AFTER = 5 * DAY  # Payment Date, after the observation date


def ts(date: str) -> int:
    return int(dt.datetime.fromisoformat(date).replace(tzinfo=dt.timezone.utc).timestamp())


def terms_of(t: dict) -> Terms:
    tw = t["twin_win"]
    return Terms(
        initial_levels=tuple(t["initial_levels"]),
        calculation_amount_cents=t["calculation_amount_cents"],
        coupon_barrier_bps=t["coupon_barrier_bps"],
        coupon_rate_bps=t["coupon_rate_bps"],
        memory=t["memory"],
        barrier_bps=t["barrier_bps"],
        schedule=tuple(Observation(**o) for o in t["schedule"]),
        twin_win=TwinWin(**tw) if tw else None,
    )


def flatten(case: dict) -> dict:
    t = case["terms"]
    model_terms = terms_of(t)
    exp = case["expected"]
    schedule = t["schedule"]
    dates = [o["date"] for o in schedule]
    last = dates.index(exp["terminated_on"])
    breach_at = dates.index(exp["breach_date"]) if exp["breach_date"] else None

    outcomes = []
    for i, date in enumerate(dates[: last + 1]):
        ev = {e["kind"]: e for e in exp["events"] if e["date"] == date}
        redemption = ev.get("mer") or ev.get("redemption")
        outcomes.append(
            {
                "breached": breach_at is not None and i >= breach_at,
                "couponPaid": "coupon" in ev,
                "couponPerCa": ev["coupon"]["per_ca_cents"] if "coupon" in ev else 0,
                "redeemed": redemption is not None,
                "redemptionPerCa": redemption["per_ca_cents"] if redemption else 0,
                "worstIndex": worst(model_terms, tuple(case["determinations"][date]))[0],
            }
        )

    tw = t["twin_win"] or {}
    return {
        "name": case["name"],
        "initialLevels": t["initial_levels"],
        "calculationAmountCents": t["calculation_amount_cents"],
        "couponBarrierBps": t["coupon_barrier_bps"],
        "couponRateBps": t["coupon_rate_bps"],
        "memory": t["memory"],
        "barrierBps": t["barrier_bps"],
        "twinWin": bool(t["twin_win"]),
        "twinUpBps": tw.get("up_participation_bps", 0),
        "twinDownBps": tw.get("down_participation_bps", 0),
        "twinCapBps": tw.get("cap_bps") or 0,
        "dates": [ts(o["date"]) for o in schedule],
        "coupon": [o["coupon"] for o in schedule],
        "mer": [o["mer"] for o in schedule],
        "barrier": [o["barrier"] for o in schedule],
        "final": [o["final"] for o in schedule],
        "merTriggerBps": [o["mer_trigger_bps"] or 0 for o in schedule],
        "levels": [case["determinations"][d] for d in dates],
        "terminatedIndex": last,
        "outcomes": outcomes,
    }


def main() -> None:
    src = json.loads((ROOT / "spikes" / "payoff" / "vectors.json").read_text())
    out = {
        "recordAfter": RECORD_AFTER,
        "paymentAfter": PAYMENT_AFTER,
        "holders": src["holders"],
        "excluded": src["excluded"],
        "cases": [flatten(c) for c in src["cases"]],
    }
    target = pathlib.Path(__file__).with_name("cases.json")
    target.write_text(json.dumps(out, indent=1) + "\n")
    print(f"{len(out['cases'])} cases -> {target.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
