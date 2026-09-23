"""Generates vectors.json: the scenario grid the contract must reproduce to the cent (S-34).

Terms are illustrative, not the term sheet. Initial Levels are chosen so that every barrier
and trigger falls on an exact integer level, which lets the grid test "exactly at" and "one
unit below" for every boundary. Run: python3 vectors.py > vectors.json
"""

from __future__ import annotations

import dataclasses
import json
import sys

from model import BPS, Observation, Terms, TwinWin, distribute, run

INITIAL = (451_200, 1_820_300, 25_000)  # e.g. 4,512.00 / 18,203.00 / 250.00 at two decimals
CA = 100_000  # EUR 1,000.00 in cents

QUARTERS = ("2027-01-15", "2027-04-15", "2027-07-15")
FINAL = "2027-10-15"


def schedule(barrier_every_date: bool, triggers=(10_000, 10_000, 10_000)) -> tuple[Observation, ...]:
    obs = tuple(
        Observation(d, coupon=True, mer=True, barrier=barrier_every_date, mer_trigger_bps=t)
        for d, t in zip(QUARTERS, triggers)
    )
    return obs + (Observation(FINAL, coupon=True, barrier=True, final=True),)


def terms(**kw) -> Terms:
    base = dict(
        initial_levels=INITIAL,
        calculation_amount_cents=CA,
        coupon_barrier_bps=7_000,
        coupon_rate_bps=250,
        memory=False,
        barrier_bps=6_000,
        schedule=schedule(False),
        twin_win=None,
    )
    base.update(kw)
    return Terms(**base)


def at(bps: int, k: int, delta: int = 0) -> int:
    """Level of underlying k at exactly `bps` of its Initial Level, plus `delta` level units."""
    level, rem = divmod(INITIAL[k] * bps, BPS)
    assert rem == 0, "choose Initial Levels so that every boundary is an exact level"
    return level + delta


def basket(worst_bps: int, delta: int = 0, worst_k: int = 0, others_bps: int = 11_000) -> tuple[int, ...]:
    return tuple(at(worst_bps, k, delta) if k == worst_k else at(others_bps, k) for k in range(3))


def calm() -> tuple[int, ...]:
    """Every underlying at 90%: coupon paid, no MER at a 100% trigger, no breach."""
    return basket(9_000, others_bps=9_500)


def path(final_levels, q=None) -> dict[str, tuple[int, ...]]:
    q = q or {}
    d = {date: q.get(i, calm()) for i, date in enumerate(QUARTERS)}
    d[FINAL] = final_levels
    return d


HOLDERS = {"investor-a": 3, "investor-b": 7, "custody-nominee": 2, "issuer-inventory": 5}
EXCLUDED = frozenset({"issuer-inventory"})


def case(name: str, clause: str, t: Terms, determinations) -> dict:
    out = run(t, determinations)
    return {
        "name": name,
        "clause": clause,
        "terms": dataclasses.asdict(t),
        "determinations": determinations,
        "expected": {
            "breached": out.breached,
            "breach_date": out.breach_date,
            "terminated_on": out.terminated_on,
            "events": [
                dict(dataclasses.asdict(e), distribution=distribute(e.per_ca_cents, HOLDERS, EXCLUDED))
                for e in out.events
            ],
        },
    }


def grid() -> list[dict]:
    t = terms()
    c = []
    # Barrier, strict (B3)
    c.append(case("final-at-barrier", "B3", t, path(basket(6_000))))
    c.append(case("final-one-unit-below-barrier", "B3", t, path(basket(6_000, -1))))
    c.append(case("final-one-unit-above-barrier", "B3", t, path(basket(6_000, +1))))
    # Coupon, inclusive (B1)
    c.append(case("coupon-at-barrier", "B1", t, path(calm(), {0: basket(7_000, others_bps=9_500)})))
    c.append(case("coupon-one-unit-below", "B1", t, path(calm(), {0: basket(7_000, -1, others_bps=9_500)})))
    # MER, inclusive (B2)
    c.append(case("mer-at-trigger", "B2", t, path(calm(), {1: basket(10_000, others_bps=12_000)})))
    c.append(case("mer-one-unit-below", "B2", t, path(calm(), {1: basket(10_000, -1, others_bps=12_000)})))
    c.append(case("mer-first-date", "S3", t, path(calm(), {0: basket(10_500, others_bps=12_000)})))
    step = terms(schedule=schedule(False, (10_000, 9_500, 9_000)))
    c.append(case("mer-step-down-at-trigger", "B2", step, path(calm(), {1: basket(9_500, others_bps=12_000)})))
    # Worst performer and ties (P4)
    tie = tuple(at(7_500, k) if k < 2 else at(11_000, k) for k in range(3))
    c.append(case("tie-two-worst", "P4", t, path(tie)))
    c.append(case("worst-is-last-underlying", "P4", t, path(basket(8_000, worst_k=2))))
    # Scenario B amounts and rounding (P7, R2)
    c.append(case("breach-half-cent-rounds-up", "R2", t, path((225_318, at(11_000, 1), at(11_000, 2)))))
    c.append(case("breach-rounds-to-nearest-up", "R2", t, path((at(5_000, 0, -1), at(11_000, 1), at(11_000, 2)))))
    c.append(case("breach-rounds-to-nearest-down", "R2", t, path((at(5_000, 0, +1), at(11_000, 1), at(11_000, 2)))))
    c.append(case("breach-level-zero", "P7", t, path(basket(0))))
    # Barrier observed on every date (B4 variant)
    amer = terms(schedule=schedule(True))
    c.append(case("american-breach-recovered-above-initial", "P7", amer, path(basket(10_200, others_bps=12_000), {1: basket(5_000)})))
    c.append(case("american-breach-final-80", "P7", amer, path(basket(8_000), {1: basket(5_000)})))
    c.append(case("american-coupon-date-at-barrier", "B3", amer, path(calm(), {0: basket(6_000)})))
    # Memory (P8)
    mem = terms(memory=True)
    c.append(case("memory-one-missed", "P8", mem, path(calm(), {0: basket(6_900, others_bps=9_500)})))
    c.append(case("no-memory-one-missed", "P8", t, path(calm(), {0: basket(6_900, others_bps=9_500)})))
    # Twin Win (P7)
    tw = terms(twin_win=TwinWin(up_participation_bps=10_000, down_participation_bps=10_000))
    c.append(case("twin-win-final-110", "P7", tw, path(basket(11_000, others_bps=12_000))))
    c.append(case("twin-win-final-75", "P7", tw, path(basket(7_500))))
    c.append(case("twin-win-at-barrier", "P7", tw, path(basket(6_000))))
    c.append(case("twin-win-below-barrier", "P7", tw, path(basket(6_000, -1))))
    capped = terms(twin_win=TwinWin(10_000, 10_000, cap_bps=12_000))
    c.append(case("twin-win-capped", "P7", capped, path(basket(6_500))))
    return c


if __name__ == "__main__":
    json.dump({"calculation_amount_cents": CA, "holders": HOLDERS, "excluded": sorted(EXCLUDED), "cases": grid()},
              sys.stdout, indent=1)
    sys.stdout.write("\n")
