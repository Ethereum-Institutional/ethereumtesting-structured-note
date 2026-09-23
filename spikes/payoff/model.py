"""Independent reference model of the note's payoff.

Implements docs/spikes/03-payoff-specification.md exactly, in exact rational arithmetic, so
that it shares no code, no numeric representation and no rounding behaviour with the contract
it checks. Every rule below cites the clause of the specification it implements.

Units. Money is integer euro cents. Levels are integers at the scale the reference source
publishes; only ratios of levels are used, so the scale cancels (P2). Barrier, trigger, rate
and participation terms are integer basis points of the Initial Level or of the Calculation
Amount (P3).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from fractions import Fraction
from typing import Optional

BPS = 10_000


# --------------------------------------------------------------------------------------------
# Terms
# --------------------------------------------------------------------------------------------


@dataclass(frozen=True)
class Observation:
    """One scheduled date. Kinds are fixed at issuance (P5)."""

    date: str
    coupon: bool = False  # coupon condition tested
    mer: bool = False  # Mandatory Early Redemption tested
    barrier: bool = False  # barrier (knock-in) observed
    final: bool = False  # Final Valuation Date
    mer_trigger_bps: Optional[int] = None  # per-date, which allows a step-down schedule


@dataclass(frozen=True)
class TwinWin:
    up_participation_bps: int
    down_participation_bps: int
    cap_bps: Optional[int] = None  # cap on the redemption, as bps of CA; None for uncapped


@dataclass(frozen=True)
class Terms:
    initial_levels: tuple[int, ...]
    calculation_amount_cents: int
    coupon_barrier_bps: int
    coupon_rate_bps: int  # per coupon date, as bps of CA
    memory: bool
    barrier_bps: int
    schedule: tuple[Observation, ...]
    twin_win: Optional[TwinWin] = None

    def validate(self) -> None:
        """Constraints checked at issuance (P6). Invalid terms are rejected, not repaired."""
        assert len(self.initial_levels) >= 1
        assert all(i > 0 for i in self.initial_levels), "Initial Levels must be positive"
        assert self.calculation_amount_cents > 0
        assert 0 < self.barrier_bps <= BPS, "barrier must lie in (0, 100%]"
        assert self.barrier_bps <= self.coupon_barrier_bps, "barrier at or below coupon barrier"
        dates = [o.date for o in self.schedule]
        assert dates == sorted(dates) and len(set(dates)) == len(dates), "schedule strictly ordered"
        finals = [o for o in self.schedule if o.final]
        assert len(finals) == 1 and self.schedule[-1].final, "exactly one final date, last"
        assert finals[0].barrier, "the barrier is always observed on the final date"
        for o in self.schedule:
            if o.mer:
                assert o.mer_trigger_bps is not None and not o.final
                assert o.mer_trigger_bps >= self.coupon_barrier_bps, "MER trigger at or above coupon barrier"
        if self.twin_win:
            tw = self.twin_win
            assert tw.cap_bps is None or tw.cap_bps >= BPS


# --------------------------------------------------------------------------------------------
# Rules
# --------------------------------------------------------------------------------------------


def performance(terms: Terms, levels: tuple[int, ...]) -> list[Fraction]:
    """Ratio of each level to its Initial Level (P2). Exact; never rounded."""
    assert len(levels) == len(terms.initial_levels)
    assert all(l >= 0 for l in levels)
    return [Fraction(l, i) for l, i in zip(levels, terms.initial_levels)]


def worst(terms: Terms, levels: tuple[int, ...]) -> tuple[int, Fraction]:
    """Worst performer (P4). The lowest ratio; on a tie, the lowest index. The index is
    reported for the record only; every amount depends on the ratio alone, so the tie-break
    cannot change a payment."""
    ratios = performance(terms, levels)
    w = min(range(len(ratios)), key=lambda k: (ratios[k], k))
    return w, ratios[w]


def at_or_above(ratio: Fraction, bps: int) -> bool:
    """Coupon and MER tests are inclusive (B1, B2): a level exactly at the barrier passes."""
    return ratio >= Fraction(bps, BPS)


def below(ratio: Fraction, bps: int) -> bool:
    """The barrier test is strict (B3): a level exactly at the barrier is not a breach."""
    return ratio < Fraction(bps, BPS)


def round_cents(x: Fraction) -> int:
    """Nearest cent, half a cent rounded up (R2). Applied once, per Calculation Amount (R1)."""
    assert x >= 0
    return int((x + Fraction(1, 2)) // 1)


def redemption_per_ca(terms: Terms, final_ratio: Fraction, breached: bool) -> int:
    """Final redemption per Calculation Amount, in cents (P7)."""
    ca = terms.calculation_amount_cents
    if breached and final_ratio < 1:
        # Scenario B. CA x (100% + Final Performance) = CA x final ratio.
        return round_cents(ca * final_ratio)
    if terms.twin_win is None:
        return ca  # Scenario A
    tw = terms.twin_win
    if final_ratio >= 1:
        x = 1 + Fraction(tw.up_participation_bps, BPS) * (final_ratio - 1)
    else:
        x = 1 + Fraction(tw.down_participation_bps, BPS) * (1 - final_ratio)
    if tw.cap_bps is not None:
        x = min(x, Fraction(tw.cap_bps, BPS))
    return round_cents(ca * x)


def coupon_per_ca(terms: Terms, periods: int) -> int:
    """Coupon per Calculation Amount for `periods` coupon periods, in cents (P8)."""
    return round_cents(Fraction(terms.calculation_amount_cents * terms.coupon_rate_bps * periods, BPS))


# --------------------------------------------------------------------------------------------
# Lifecycle
# --------------------------------------------------------------------------------------------


@dataclass
class Event:
    date: str
    kind: str  # "coupon" | "mer" | "redemption"
    per_ca_cents: int
    worst_index: int
    worst_ratio: str  # exact, as "num/den", for the record


@dataclass
class Outcome:
    events: list[Event] = field(default_factory=list)
    breached: bool = False
    breach_date: Optional[str] = None
    terminated_on: Optional[str] = None


def run(terms: Terms, determinations: dict[str, tuple[int, ...]]) -> Outcome:
    """Evaluate the schedule in order (S1). On each date the barrier is observed first, then
    the coupon, then MER (S2). Evaluation stops at the first MER or the final date (S3)."""
    terms.validate()
    out = Outcome()
    missed = 0
    for o in terms.schedule:
        levels = determinations[o.date]
        w, r = worst(terms, levels)
        ratio = f"{r.numerator}/{r.denominator}"
        if o.barrier and not out.breached and below(r, terms.barrier_bps):
            out.breached, out.breach_date = True, o.date
        if o.coupon:
            if at_or_above(r, terms.coupon_barrier_bps):
                periods = 1 + (missed if terms.memory else 0)
                out.events.append(Event(o.date, "coupon", coupon_per_ca(terms, periods), w, ratio))
                missed = 0
            else:
                missed += 1
        if o.mer and at_or_above(r, o.mer_trigger_bps):
            out.events.append(Event(o.date, "mer", terms.calculation_amount_cents, w, ratio))
            out.terminated_on = o.date
            return out
        if o.final:
            amount = redemption_per_ca(terms, r, out.breached)
            out.events.append(Event(o.date, "redemption", amount, w, ratio))
            out.terminated_on = o.date
            return out
    raise AssertionError("schedule has no final date")


def distribute(per_ca_cents: int, holders: dict[str, int], excluded: frozenset[str] = frozenset()) -> dict[str, int]:
    """Per-holder amounts (R1, E1). Units are whole Calculation Amounts, so each holder
    receives exactly per_ca x units and the total equals per_ca x units entitled, with no
    residue to allocate. Excluded accounts (the Issuer's own inventory, E2) receive nothing."""
    assert all(isinstance(u, int) and u >= 0 for u in holders.values())
    return {h: per_ca_cents * u for h, u in holders.items() if h not in excluded and u > 0}
