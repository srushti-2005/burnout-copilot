"""save_session end to end against an in-memory Supabase."""
from datetime import datetime, timedelta, timezone

import pytest

from src.data import supabase_manager as sm
try:
    from tests.fake_supabase import FakeSupabase
except ImportError:  # tests/ is not a package in this repo
    from fake_supabase import FakeSupabase

WEIGHTS = {
    "typing_mean_norm": 0.25, "typing_variance_norm": 0.20,
    "task_switching_norm": 0.25, "work_duration_norm": 0.20, "late_night": 0.10,
}
BOUNDS = {
    "typing_mean": (0.0, 80.0), "typing_variance": (0.0, 25.0),
    "task_switching": (0.0, 60.0), "work_duration": (0.0, 12.0),
}
UID = "user-1"


class Clock:
    def __init__(self):
        self.t = datetime(2026, 10, 18, 8, 0, tzinfo=timezone.utc)

    def __call__(self):
        return self.t

    def advance(self, minutes):
        self.t += timedelta(minutes=minutes)


@pytest.fixture
def env(monkeypatch):
    clock = Clock()
    db = FakeSupabase(clock)
    monkeypatch.setattr(sm, "get_service_client", lambda: db)
    monkeypatch.setattr(sm, "_utcnow", clock)
    monkeypatch.setattr(sm, "get_training_weights", lambda *a, **k: WEIGHTS)
    monkeypatch.setattr(sm, "get_training_bounds", lambda *a, **k: BOUNDS)
    return db, clock


def payload(tm=0.0, tv=0.0, ts=0, wd=0.05, late=0, **extra):
    return {"typing_mean": tm, "typing_variance": tv, "task_switching": ts,
            "work_duration": wd, "late_night": late, **extra}


def sessions(db):
    return db.tables.get("sessions", [])


def test_idle_session_is_zero_and_does_not_touch_baseline(env):
    db, _ = env
    res = sm.save_session(UID, payload())
    assert res.data[0]["cli_score"] == 0.0
    assert not db.tables.get("user_baselines")


def test_active_session_scores_and_updates_baseline(env):
    db, _ = env
    res = sm.save_session(UID, payload(tm=40, tv=10, ts=20, wd=0.5))
    assert res.data[0]["cli_score"] > 0
    assert db.tables["user_baselines"][0]["session_count"] == 1


def test_idle_after_active_decays_to_exactly_zero(env):
    db, clock = env
    sm.save_session(UID, payload(tm=60, tv=15, ts=30, wd=0.5))
    values = []
    for i in range(40):
        clock.advance(2)
        sm.save_session(UID, payload(wd=0.5 + 0.03 * (i + 1)))
        values.append(sessions(db)[-1]["cli_score"])
    assert values == sorted(values, reverse=True)
    assert values[-1] == 0.0
    assert all(a - b <= 0.021 for a, b in zip(values, values[1:]))


def test_duplicate_upload_is_stored_once(env):
    db, clock = env
    sm.save_session(UID, payload(tm=40, tv=10, ts=5, wd=0.2))
    clock.advance(0.2)  # 12 s later, same window re-sent (retry after cold start)
    again = sm.save_session(UID, payload(tm=40, tv=10, ts=5, wd=0.2))
    assert len(sessions(db)) == 1
    assert again.data[0]["id"] == sessions(db)[0]["id"]
    assert db.tables["user_baselines"][0]["session_count"] == 1


def test_same_values_much_later_is_not_a_duplicate(env):
    db, clock = env
    sm.save_session(UID, payload(tm=40, tv=10, ts=5, wd=0.2))
    clock.advance(5)
    sm.save_session(UID, payload(tm=40, tv=10, ts=5, wd=0.2))
    assert len(sessions(db)) == 2


def test_different_device_is_not_a_duplicate(env):
    db, clock = env
    sm.save_session(UID, payload(tm=40, tv=10, ts=5, wd=0.2, device_source="web"))
    clock.advance(0.2)
    sm.save_session(UID, payload(tm=40, tv=10, ts=5, wd=0.2, device_source="mobile"))
    assert len(sessions(db)) == 2
    assert {s["device_source"] for s in sessions(db)} == {"web", "mobile"}


def test_device_source_is_stored(env):
    db, _ = env
    sm.save_session(UID, payload(tm=5, device_source="mobile"))
    assert sessions(db)[0]["device_source"] == "mobile"


def test_overnight_gap_starts_fresh(env):
    db, clock = env
    sm.save_session(UID, payload(tm=70, tv=20, ts=40, wd=3.0))
    clock.advance(10 * 60)
    sm.save_session(UID, payload(tm=2, wd=0.03))
    assert sessions(db)[-1]["cli_score"] < 0.05


def test_backdated_timezone_aware_timestamp_is_honoured(env):
    db, clock = env
    when = clock() - timedelta(hours=3)
    sm.save_session(UID, payload(tm=10, timestamp_utc=when))
    assert datetime.fromisoformat(sessions(db)[0]["created_at"]) == when


@pytest.mark.parametrize("bad", [
    datetime(2026, 10, 18, 5, 0),                                  # naive
    datetime(2026, 10, 18, 9, 0, tzinfo=timezone.utc),             # future
    datetime(2026, 10, 10, 5, 0, tzinfo=timezone.utc),             # > 48 h old
    "not a date",
])
def test_untrusted_timestamps_fall_back_to_now(env, bad):
    db, clock = env
    sm.save_session(UID, payload(tm=10, timestamp_utc=bad))
    assert datetime.fromisoformat(sessions(db)[0]["created_at"]) == clock()


def test_scoring_failure_still_saves_the_row(env, monkeypatch):
    db, _ = env
    monkeypatch.setattr(sm, "compute_session_cli", lambda *a, **k: 1 / 0)
    res = sm.save_session(UID, payload(tm=10))
    assert len(sessions(db)) == 1 and res.data[0]["cli_score"] == 0.0


def test_unparseable_previous_timestamp_does_not_break_scoring(env):
    db, clock = env
    sm.save_session(UID, payload(tm=40, tv=10, ts=5))
    sessions(db)[0]["created_at"] = "garbage"
    clock.advance(3)
    sm.save_session(UID, payload(tm=40, tv=10, ts=6))
    assert len(sessions(db)) == 2
