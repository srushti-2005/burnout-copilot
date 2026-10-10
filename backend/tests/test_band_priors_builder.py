# tests/test_band_priors_builder.py
import json

import pytest

from src.personalization import baseline_prior as bp
from src.personalization.build_band_priors import (
    compute_band_priors, fetch_users, save_band_priors,
)


def _u(age, sessions, late, dur=100.0):
    return {"age": age, "session_count": sessions,
            "late_night_avg": late, "work_duration_avg": dur}


USERS = (
    [_u(20, 8, v) for v in (0.6, 0.8, 0.7)] +
    [_u(50, 8, v) for v in (0.1, 0.2, 0.0)]
)


def test_shrunk_band_means():
    bands = compute_band_priors(USERS, k0=10.0)
    pooled = 0.4
    assert bands["18-25"]["n_users"] == 3
    assert bands["18-25"]["means"]["late_night"] == pytest.approx((3 * 0.7 + 10 * pooled) / 13)
    assert bands["41-60"]["means"]["late_night"] == pytest.approx((3 * 0.1 + 10 * pooled) / 13)
    assert set(bands["18-25"]["means"]) == {"late_night", "work_duration"}


def test_excludes_new_unknown_and_bad_rows():
    users = USERS + [_u(20, 2, 0.99), _u(None, 9, 0.99), _u("x", 9, 0.99),
                     _u(20, "bad", 0.99), _u(20, 9, None)]
    bands = compute_band_priors(users, k0=10.0)
    assert bands["18-25"]["n_users"] == 4              # last row counts, but has no late_night value
    assert bands["18-25"]["means"]["late_night"] == pytest.approx((3 * 0.7 + 10 * 0.4) / 13)


def test_no_users_gives_empty():
    assert compute_band_priors([]) == {}


def test_save_and_load_roundtrip(tmp_path):
    path = str(tmp_path / "p.json")
    save_band_priors(compute_band_priors(USERS), path)
    saved = json.load(open(path))
    assert "bands" in saved and "meta" in saved
    assert "age" not in json.dumps(saved["bands"]).lower().replace("age_band", "")  # aggregates only
    loaded = bp.load_band_priors(path)
    assert loaded["18-25"]["n_users"] == 3
    assert set(loaded["18-25"]["means"]) <= set(bp.BASELINE_FEATURES)


def test_load_missing_or_malformed_is_empty(tmp_path):
    assert bp.load_band_priors(str(tmp_path / "nope.json")) == {}
    bad = tmp_path / "bad.json"; bad.write_text("{not json")
    assert bp.load_band_priors(str(bad)) == {}


def test_learned_prior_used_only_with_enough_users(tmp_path, monkeypatch):
    monkeypatch.setattr(bp, "AGE_BAND_PRIORS", {})
    monkeypatch.setattr(bp, "USE_GLOBAL_FALLBACK_PRIOR", False)
    bands = compute_band_priors(USERS)
    monkeypatch.setattr(bp, "AGE_BAND_PRIORS", bands)
    assert not bp.has_reliable_band_priors()          # n=3 < 30
    assert bp.get_baseline_prior(20) == {}
    bands["18-25"]["n_users"] = bp.MIN_USERS_PER_BAND
    assert bp.get_baseline_prior(20)["late_night"] == pytest.approx(bands["18-25"]["means"]["late_night"])
    assert bp.get_baseline_prior(50) == {}            # other band still too small


class _FakeSB:
    def __init__(self, tables): self.t = tables
    def table(self, name): self.cur = name; return self
    def select(self, cols): return self
    def range(self, a, b): self.a, self.b = a, b; return self
    def execute(self):
        return type("R", (), {"data": self.t[self.cur][self.a:self.b + 1]})()


def test_fetch_users_joins_and_pages():
    profiles = [{"id": f"u{i}", "age": 20 + i} for i in range(2500)]
    baselines = [{"user_id": f"u{i}", "session_count": 6, "late_night_avg": 0.5,
                  "work_duration_avg": 90.0} for i in range(2500)]
    users = fetch_users(_FakeSB({"profiles": profiles, "user_baselines": baselines}))
    assert len(users) == 2500 and users[7]["age"] == 27