"""Checks the reference model against hand-computed figures and against the properties the
specification asserts. Run: python3 -m unittest -v"""

import itertools
import json
import subprocess
import sys
import unittest
from fractions import Fraction
from pathlib import Path

from model import Terms, distribute, redemption_per_ca, round_cents, run
from vectors import CA, EXCLUDED, HOLDERS, INITIAL, grid, terms

HERE = Path(__file__).parent


def by_name():
    return {c["name"]: c["expected"] for c in grid()}


def amounts(expected, kind):
    return [e["per_ca_cents"] for e in expected["events"] if e["kind"] == kind]


class HandComputed(unittest.TestCase):
    """Figures worked by hand from the specification, independent of the model's code."""

    def setUp(self):
        self.v = by_name()

    def test_barrier_strict(self):
        self.assertFalse(self.v["final-at-barrier"]["breached"])
        self.assertEqual(amounts(self.v["final-at-barrier"], "redemption"), [100_000])
        # One unit below: 270,719 / 451,200 x 100,000 = 59,999.778 cents -> 60,000 (EUR 600.00).
        # The payoff is discontinuous at the barrier by design: EUR 1,000.00 at it, EUR 600.00 below.
        self.assertTrue(self.v["final-one-unit-below-barrier"]["breached"])
        self.assertEqual(amounts(self.v["final-one-unit-below-barrier"], "redemption"), [60_000])
        self.assertFalse(self.v["final-one-unit-above-barrier"]["breached"])

    def test_coupon_and_mer_inclusive(self):
        self.assertEqual(amounts(self.v["coupon-at-barrier"], "coupon")[0], 2_500)
        self.assertEqual(len(amounts(self.v["coupon-one-unit-below"], "coupon")), 3)  # first date missed
        self.assertEqual(self.v["mer-at-trigger"]["terminated_on"], "2027-04-15")
        self.assertEqual(amounts(self.v["mer-at-trigger"], "mer"), [100_000])
        self.assertEqual(amounts(self.v["mer-at-trigger"], "coupon"), [2_500, 2_500])  # coupon on the MER date too
        self.assertEqual(self.v["mer-one-unit-below"]["terminated_on"], "2027-10-15")
        self.assertEqual(self.v["mer-step-down-at-trigger"]["terminated_on"], "2027-04-15")

    def test_rounding(self):
        # 225,318 / 451,200 x 100,000 = 49,937.5 cents exactly -> 49,938 (half up)
        self.assertEqual(amounts(self.v["breach-half-cent-rounds-up"], "redemption"), [49_938])
        # 225,599 / 451,200 x 100,000 = 49,999.778 -> 50,000 (nearest, upward)
        self.assertEqual(amounts(self.v["breach-rounds-to-nearest-up"], "redemption"), [50_000])
        # 225,601 / 451,200 x 100,000 = 50,000.222 -> 50,000 (nearest, downward)
        self.assertEqual(amounts(self.v["breach-rounds-to-nearest-down"], "redemption"), [50_000])
        self.assertEqual(amounts(self.v["breach-level-zero"], "redemption"), [0])

    def test_breach_then_recovery(self):
        v = self.v["american-breach-recovered-above-initial"]
        self.assertTrue(v["breached"])
        self.assertEqual(amounts(v, "redemption"), [100_000], "breach with final at or above initial pays par")
        self.assertEqual(amounts(self.v["american-breach-final-80"], "redemption"), [80_000])
        self.assertFalse(self.v["american-coupon-date-at-barrier"]["breached"])

    def test_memory(self):
        self.assertEqual(amounts(self.v["memory-one-missed"], "coupon"), [5_000, 2_500, 2_500])
        self.assertEqual(amounts(self.v["no-memory-one-missed"], "coupon"), [2_500, 2_500, 2_500])

    def test_twin_win(self):
        self.assertEqual(amounts(self.v["twin-win-final-110"], "redemption"), [110_000])
        self.assertEqual(amounts(self.v["twin-win-final-75"], "redemption"), [125_000])
        self.assertEqual(amounts(self.v["twin-win-at-barrier"], "redemption"), [140_000])
        self.assertEqual(amounts(self.v["twin-win-below-barrier"], "redemption"), [60_000])
        self.assertEqual(amounts(self.v["twin-win-capped"], "redemption"), [120_000])

    def test_tie(self):
        v = self.v["tie-two-worst"]
        self.assertEqual(v["events"][-1]["worst_index"], 0)
        self.assertEqual(self.v["worst-is-last-underlying"]["events"][-1]["worst_index"], 2)

    def test_distribution(self):
        d = self.v["final-at-barrier"]["events"][-1]["distribution"]
        self.assertEqual(d, {"investor-a": 300_000, "investor-b": 700_000, "custody-nominee": 200_000})


class Properties(unittest.TestCase):
    def test_round_half_up(self):
        self.assertEqual(round_cents(Fraction(1, 2)), 1)
        self.assertEqual(round_cents(Fraction(3, 2)), 2)
        self.assertEqual(round_cents(Fraction(499, 1000)), 0)
        self.assertEqual(round_cents(Fraction(0)), 0)

    def test_redemption_monotone_in_worst_ratio(self):
        t = terms()
        for breached in (False, True):
            prev = -1
            for n in range(0, 20_001, 7):
                a = redemption_per_ca(t, Fraction(n, 10_000), breached)
                self.assertGreaterEqual(a, prev)
                prev = a

    def test_breached_never_exceeds_par(self):
        t = terms()
        for n in range(0, 30_001, 11):
            self.assertLessEqual(redemption_per_ca(t, Fraction(n, 10_000), True), CA)

    def test_amounts_invariant_to_underlying_order(self):
        """Reordering the basket changes only the reported index, never an amount."""
        for c in grid():
            base = [e["per_ca_cents"] for e in c["expected"]["events"]]
            for perm in itertools.permutations(range(3)):
                t = c["terms"]
                pt = Terms(
                    initial_levels=tuple(t["initial_levels"][k] for k in perm),
                    calculation_amount_cents=t["calculation_amount_cents"],
                    coupon_barrier_bps=t["coupon_barrier_bps"],
                    coupon_rate_bps=t["coupon_rate_bps"],
                    memory=t["memory"],
                    barrier_bps=t["barrier_bps"],
                    schedule=_schedule(t),
                    twin_win=_twin(t),
                )
                d = {date: tuple(l[k] for k in perm) for date, l in c["determinations"].items()}
                self.assertEqual([e.per_ca_cents for e in run(pt, d).events], base, c["name"])

    def test_distribution_exact(self):
        for per_ca in (0, 1, 49_938, 100_000, 140_000):
            d = distribute(per_ca, HOLDERS, EXCLUDED)
            entitled = sum(u for h, u in HOLDERS.items() if h not in EXCLUDED)
            self.assertEqual(sum(d.values()), per_ca * entitled)
            self.assertNotIn("issuer-inventory", d)

    def test_invalid_terms_rejected(self):
        for bad in (dict(barrier_bps=7_500), dict(barrier_bps=0), dict(initial_levels=(0, 1, 1))):
            with self.assertRaises(AssertionError):
                terms(**bad).validate()

    def test_committed_vectors_current(self):
        """vectors.json must be regenerated whenever the model or the grid changes."""
        fresh = subprocess.run([sys.executable, "vectors.py"], cwd=HERE, capture_output=True, text=True, check=True)
        self.assertEqual(json.loads(fresh.stdout), json.loads((HERE / "vectors.json").read_text()))


def _schedule(t):
    from model import Observation
    return tuple(Observation(**o) for o in t["schedule"])


def _twin(t):
    from model import TwinWin
    return TwinWin(**t["twin_win"]) if t["twin_win"] else None


if __name__ == "__main__":
    unittest.main()
