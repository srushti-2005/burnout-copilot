"""CLI dynamics: zero stats -> zero CLI, gradual movement, no floor, no cliffs."""
import math

import pytest

from src import cli_logic as cl

WEIGHTS = {
    "typing_mean_norm": 0.25, "typing_variance_norm": 0.20,
    "task_switching_norm": 0.25, "work_duration_norm": 0.20, "late_night": 0.10,
}
BOUNDS = {
    "typing_mean": (0.0, 80.0), "typing_variance": (0.0, 25.0),
    "task_switching": (0.0, 60.0), "work_duration": (0.0, 12.0),
}


def row(tm=0.0, tv=0.0, ts=0, wd=0.0, late=0):
    return {"typing_mean": tm, "typing_variance": tv, "task_switching": ts,
            "work_duration": wd, "late_night": late}


def inst(**kw):
    return cl.instant_cli(row(**kw), WEIGHTS, BOUNDS)


# ── zero stats -> zero CLI ────────────────────────────────────────────
def test_all_zero_is_zero():
    assert inst() == 0.0


def test_work_duration_alone_is_not_load():
    # elapsed time with no typing / switching is idle, not cognitive load
    assert inst(wd=0.47) == 0.0


def test_none_and_nan_values_are_idle():
    r = {"typing_mean": None, "typing_variance": float("nan"), "task_switching": None,
         "work_duration": 0.2, "late_night": None}
    assert cl.is_idle(r)
    assert cl.instant_cli(r, WEIGHTS, BOUNDS) == 0.0


def test_any_signal_gives_positive_load():
    assert inst(tm=4.5) > 0
    assert inst(ts=3) > 0
    assert inst(late=1) == pytest.approx(0.10, abs=1e-3)


def test_real_light_activity_is_not_clipped_to_zero():
    # the original bug: real values below the synthetic dataset minimum -> 0
    assert inst(tm=0.5, tv=0.25, ts=3, wd=0.62) > 0


def test_out_of_range_input_is_clamped():
    assert 0.0 <= inst(tm=500, tv=9999, ts=500, wd=99, late=1) <= 1.0


# ── gradual movement, no cliffs, no floor ─────────────────────────────
def test_rise_is_gradual_at_two_minute_cadence():
    v, steps = 0.0, []
    for _ in range(30):
        n = cl.next_cli(v, 0.5, 2.0)
        steps.append(n - v)
        v = n
    assert max(steps) <= 0.04 + 0.001
    assert min(steps) >= 0
    assert v > 0.4  # it does get there


def test_idle_decays_gradually_and_reaches_exactly_zero():
    v, steps, n_rows = 0.20, [], 0
    while v > 0 and n_rows < 60:
        nxt = cl.next_cli(v, 0.0, 2.0)
        steps.append(v - nxt)
        v, n_rows = nxt, n_rows + 1
    assert v == 0.0                      # no floor: really zero
    assert max(steps) <= 0.02 + 0.001    # never a cliff (3 dp rounding)
    assert min(steps) >= 0               # monotonic
    assert n_rows <= 25                  # ~50 min of idle at 2-min cadence


def test_first_session_starts_gradually_not_at_instant():
    assert cl.next_cli(None, 0.6, None) <= 0.10


def test_first_idle_session_is_zero():
    assert cl.next_cli(None, 0.0, None) == 0.0


def test_overnight_gap_resets():
    assert cl.next_cli(0.5, 0.0, 10 * 60) == 0.0
    assert cl.next_cli(0.5, 0.2, 10 * 60) <= 0.12


def test_short_gap_keeps_fatigue():
    assert cl.next_cli(0.3, 0.0, 2.0) >= 0.28


def test_smooth_handles_garbage():
    assert cl.smooth_cli(None, None, None) == 0.0
    assert cl.smooth_cli(float("nan"), 0.5, 2.0) <= 0.04
    assert cl.smooth_cli(5.0, 0.0, 2.0) <= 1.0


# ── what the dashboard shows between uploads ──────────────────────────
def test_live_cli_unchanged_within_grace():
    assert cl.live_cli(0.25, 4.0, 5.0) == 0.25


def test_live_cli_rests_to_zero_when_agent_stops():
    assert cl.live_cli(0.25, 3.0 + 60, 3.0) == 0.0
    mid = cl.live_cli(0.25, 3.0 + 10, 3.0)
    assert 0.0 < mid < 0.25


# ── the full pipeline ────────────────────────────────────────────────
def test_compute_session_cli_idle_after_active_decays():
    prev = {"cli_score": 0.2, "cli_score_raw": 0.2}
    raw, adj, risk = cl.compute_session_cli(row(wd=0.3), prev, 2.0, 1.0, WEIGHTS, BOUNDS)
    assert 0.18 <= adj < 0.2 and risk == "Low"


def test_context_multiplier_scales_load_but_zero_stays_zero():
    _, adj, _ = cl.compute_session_cli(row(), None, None, 1.1, WEIGHTS, BOUNDS)
    assert adj == 0.0


def test_replay_of_real_log_final_stretch_goes_to_zero():
    """Rows 10-18 13:47 .. 14:13 from the user's check_data output: typing,
    variance and switches all 0, work_duration small. Before the fix the
    stored CLI sat at 0.19 -> 0.14 and never reached 0."""
    cli = 0.202                      # value stored at 13:44:07
    gaps = [3.57, .13, .08, 2.07, 2.07, 2.07, 2.07, 2.07, 2.07, 2.07, 2.07, 8.73]
    seq = []
    for g in gaps:
        cli = cl.next_cli(cli, cl.instant_cli(row(wd=0.05), WEIGHTS, BOUNDS), g)
        seq.append(cli)
    assert all(a >= b for a, b in zip(seq, seq[1:]))         # only falls
    # gradual: a fall of at most 1% per minute elapsed
    prevs = [0.202] + seq[:-1]
    assert all(a - b <= 0.01 * g + 0.001 for a, b, g in zip(prevs, seq, gaps))  # +0.001: scores are stored rounded to 3 dp
    assert seq[-1] < 0.10                                    # clearly heading to 0


def test_rows_seconds_apart_cannot_cause_a_cliff():
    v = 0.2
    for _ in range(5):          # five uploads inside ~10 seconds
        v = cl.next_cli(v, 0.0, 0.03)
    assert v >= 0.199
