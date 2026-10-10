# tests/test_age_integration.py
import pytest

from src.cli_logic import categorize_cli
from src.personalization import baseline_prior as bp
from src.personalization.age_burnout_model import (
    apply_age_adjustment,
    get_age_adjustment,
    get_age_band,
)

AGES = [None, 0, 10, 17, 18, 25, 26, 37, 41, 50, 60, 61, 90, 150]


def _expected(cli):
    if cli < 0.4:
        return "Low"
    if cli < 0.7:
        return "Medium"
    return "High"


# ---------------- CLI categories are age-independent ----------------

def test_categorize_without_age():
    assert categorize_cli(0.72) == "High"


def test_categorize_with_age_none():
    assert categorize_cli(0.72, age=None) == "High"


@pytest.mark.parametrize("age", AGES)
@pytest.mark.parametrize("cli", [0.0, 0.39, 0.4, 0.68, 0.69, 0.7, 0.72, 1.0])
def test_age_never_changes_category(age, cli):
    assert categorize_cli(cli, age=age) == _expected(cli)


def test_old_age_sensitive_cases_now_use_fixed_thresholds():
    # These used to flip to "High" via age shifts; they must now be "Medium".
    for age in (17, 25, 50):
        assert categorize_cli(0.68, age=age) == "Medium"


# ---------------- deprecated shims are no-ops ----------------

@pytest.mark.parametrize("age", AGES)
def test_apply_age_adjustment_is_noop(age):
    m, h, adj = apply_age_adjustment(0.4, 0.7, age)
    assert (m, h) == (0.4, 0.7)
    assert adj.medium_threshold_shift == 0.0
    assert adj.high_threshold_shift == 0.0


def test_get_age_adjustment_zero_shift():
    adj = get_age_adjustment(25)
    assert adj.medium_threshold_shift == 0.0 and adj.high_threshold_shift == 0.0


# ---------------- age bands ----------------

@pytest.mark.parametrize("age,band", [
    (None, "unknown"), ("abc", "unknown"), (-5, "unknown"), (150, "unknown"),
    (True, "unknown"),
    (0, "<18"), (17, "<18"), (18, "18-25"), (25, "18-25"), (26, "26-40"),
    (40, "26-40"), (41, "41-60"), (60, "41-60"), (61, ">60"), (120, ">60"),
])
def test_age_band(age, band):
    assert get_age_band(age) == band


# ---------------- baseline prior ----------------

GLOBAL = {"typing_mean": 0.2, "typing_variance": 0.2, "task_switching": 0.2,
          "work_duration": 0.2, "late_night": 0.2}


@pytest.fixture(autouse=True)
def _clean(monkeypatch):
    monkeypatch.setattr(bp, "get_global_prior", lambda path=None: dict(GLOBAL))
    monkeypatch.setattr(bp, "AGE_BAND_PRIORS", {})
    monkeypatch.setattr(bp, "USE_GLOBAL_FALLBACK_PRIOR", False)


def test_prior_weight():
    assert bp.prior_weight(0) == 1.0
    assert bp.prior_weight(5) == pytest.approx(3 / 8)
    assert bp.prior_weight(None) == 1.0
    assert bp.prior_weight(-3) == 1.0
    assert bp.prior_weight(1000) < 0.01


def test_default_is_no_prior_and_no_change():
    user = {f"{f}_avg": 0.5 for f in bp.BASELINE_FEATURES}
    assert not bp.baseline_prior_enabled()
    assert not bp.has_reliable_band_priors()
    assert bp.get_baseline_prior(25) == {}
    out = bp.blend_baseline(user, 3, age=25)
    assert out["prior_weight"] == 0.0
    for f in bp.BASELINE_FEATURES:
        assert out[f"{f}_avg"] == 0.5


def test_age_has_no_effect_without_reliable_band_prior():
    user = {f"{f}_avg": 0.5 for f in bp.BASELINE_FEATURES}
    a = bp.blend_baseline(user, 2, age=20)
    b = bp.blend_baseline(user, 2, age=70)
    assert {k: v for k, v in a.items() if k != "age_band"} == \
           {k: v for k, v in b.items() if k != "age_band"}


def test_band_prior_requires_enough_users(monkeypatch):
    monkeypatch.setitem(bp.AGE_BAND_PRIORS, "18-25",
                        {"n_users": 29, "means": {"late_night": 0.9}})
    assert not bp.has_reliable_band_priors()
    assert bp.get_baseline_prior(20) == {}

    monkeypatch.setitem(bp.AGE_BAND_PRIORS, "18-25",
                        {"n_users": 30, "means": {"late_night": 0.9}})
    assert bp.has_reliable_band_priors() and bp.baseline_prior_enabled()
    assert bp.get_baseline_prior(20)["late_night"] == 0.9
    assert bp.get_baseline_prior(70) == {}          # other band: no prior


def test_band_prior_blend_values(monkeypatch):
    monkeypatch.setitem(bp.AGE_BAND_PRIORS, "18-25",
                        {"n_users": 30, "means": {"late_night": 0.2}})
    user = {f"{f}_avg": 0.5 for f in bp.BASELINE_FEATURES}
    out = bp.blend_baseline(user, 5, age=22)
    assert out["late_night_avg"] == pytest.approx(0.625 * 0.5 + 0.375 * 0.2)
    assert out["typing_mean_avg"] == pytest.approx(0.5)   # no prior for it
    assert out["prior_weight"] == pytest.approx(3 / 8)
    assert out["age_band"] == "18-25"


def test_global_fallback_only_when_enabled(monkeypatch):
    monkeypatch.setattr(bp, "USE_GLOBAL_FALLBACK_PRIOR", True)
    assert bp.baseline_prior_enabled()
    assert bp.get_baseline_prior(None)["late_night"] == 0.2
    zeros = {f"{f}_avg": 0 for f in bp.BASELINE_FEATURES}
    out = bp.blend_baseline(zeros, 0, age=25)
    assert out["late_night_avg"] == pytest.approx(0.2)
    assert out["prior_weight"] == 1.0


def test_prior_fades_with_sessions():
    user = {f"{f}_avg": 1.0 for f in bp.BASELINE_FEATURES}
    prior = {"late_night": 0.0}
    early = bp.blend_baseline(user, 1, prior=prior)["late_night_avg"]
    late = bp.blend_baseline(user, 50, prior=prior)["late_night_avg"]
    assert early < late < 1.0