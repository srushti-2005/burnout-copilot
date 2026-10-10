# src/personalization/baseline_prior.py
"""
Age-aware PRIOR for the personalized baseline (cold start only).

blended_mean = w_user * user_running_avg + w_prior * prior_mean
w_prior      = KAPPA / (KAPPA + session_count)     (fades as sessions grow)

- This module never touches the CLI score, CRITIC weights, the ML model,
  CLI categories, or interventions.
- A prior exists ONLY when the user's age band has at least
  MIN_USERS_PER_BAND real users. Band priors are LEARNED from your own
  users (see src/personalization/build_band_priors.py), written to
  data/processed/age_band_priors.json, and loaded here at import time.
  No numbers are hand-set. If the file is missing or no band has enough
  users, there is no prior and the baseline is exactly the user's own
  running averages (no change in behaviour).
- USE_GLOBAL_FALLBACK_PRIOR (default False) optionally falls back to the
  age-neutral training-data mean when no band prior exists. It is OFF so
  that nothing changes for any user until you choose to enable it.
- Pure functions: no database access.
"""

import json
import os
from typing import Mapping, Optional

import pandas as pd

from src.cli_logic import DEFAULT_DATA_PATH
from src.personalization.age_burnout_model import get_age_band

BASELINE_FEATURES = (
    "typing_mean",
    "typing_variance",
    "task_switching",
    "work_duration",
    "late_night",
)

# Prior strength expressed in "pseudo-sessions".
KAPPA = 3.0

# A band prior is used only when estimated from at least this many users.
MIN_USERS_PER_BAND = 30

# Where build_band_priors.py writes the learned priors (aggregates only).
BAND_PRIORS_PATH = os.path.join(
    os.path.dirname(os.path.dirname(DEFAULT_DATA_PATH)),
    "processed", "age_band_priors.json",
)


def load_band_priors(path: str = BAND_PRIORS_PATH) -> dict:
    """
    Reads learned band priors: {band: {"n_users": int, "means": {feature: float}}}.
    Returns {} if the file is missing or malformed (never raises).
    """
    try:
        with open(path, "r", encoding="utf-8") as fh:
            data = json.load(fh)
        bands = data.get("bands", {}) if isinstance(data, dict) else {}
        clean: dict = {}
        for band, entry in bands.items():
            means = {
                f: float(v)
                for f, v in (entry.get("means") or {}).items()
                if f in BASELINE_FEATURES
            }
            if means:
                clean[band] = {"n_users": int(entry.get("n_users", 0)), "means": means}
        return clean
    except Exception:
        return {}


# Learned from real per-user data; restart the API after rebuilding.
AGE_BAND_PRIORS: dict[str, dict] = load_band_priors()

# Off by default: no prior at all unless a reliable band prior exists.
USE_GLOBAL_FALLBACK_PRIOR = False

_GLOBAL_PRIOR_CACHE: dict[str, dict] = {}


def get_global_prior(path: str = DEFAULT_DATA_PATH) -> dict:
    """
    Mean of each raw baseline feature in the training dataset (cached).
    Returns {} if the file or columns are unavailable.
    """
    if path not in _GLOBAL_PRIOR_CACHE:
        prior: dict = {}
        try:
            df = pd.read_csv(path)
            for f in BASELINE_FEATURES:
                if f in df.columns:
                    prior[f] = float(df[f].mean())
        except Exception:
            prior = {}
        _GLOBAL_PRIOR_CACHE[path] = prior
    return _GLOBAL_PRIOR_CACHE[path]


def has_reliable_band_priors() -> bool:
    """True if at least one age band has enough users for its own prior."""
    return any(
        (entry or {}).get("n_users", 0) >= MIN_USERS_PER_BAND
        for entry in AGE_BAND_PRIORS.values()
    )


def baseline_prior_enabled() -> bool:
    """True if any prior could be applied at all."""
    return has_reliable_band_priors() or USE_GLOBAL_FALLBACK_PRIOR


def get_baseline_prior(age: int | None = None, path: str = DEFAULT_DATA_PATH) -> dict:
    """
    Band prior if reliably estimated; otherwise the global prior only if
    USE_GLOBAL_FALLBACK_PRIOR is on; otherwise {} (no prior).
    """
    band = get_age_band(age)
    entry = AGE_BAND_PRIORS.get(band)
    if entry and entry.get("n_users", 0) >= MIN_USERS_PER_BAND:
        return dict(entry.get("means", {}))
    if USE_GLOBAL_FALLBACK_PRIOR:
        return dict(get_global_prior(path))
    return {}


def prior_weight(session_count: int | None, kappa: float = KAPPA) -> float:
    """Weight on the prior: 1.0 at 0 sessions, decreasing toward 0."""
    try:
        n = max(int(session_count or 0), 0)
    except (TypeError, ValueError):
        n = 0
    return kappa / (kappa + n)


def blend_baseline(
    user_baseline: Mapping[str, float],
    session_count: int | None,
    age: int | None = None,
    prior: Optional[Mapping[str, float]] = None,
    path: str = DEFAULT_DATA_PATH,
) -> dict:
    """
    Blends the user's running averages (keys like "typing_mean_avg")
    with the prior. Returns the five "<feature>_avg" values plus
    "prior_weight" and "age_band" metadata.

    If no prior is available, the user's own values are returned
    unchanged and prior_weight is 0.0. A feature with no prior value is
    returned as the user's own value.
    """
    if prior is None:
        prior = get_baseline_prior(age, path)

    w_prior = prior_weight(session_count) if prior else 0.0
    w_user = 1.0 - w_prior

    out: dict = {}
    for f in BASELINE_FEATURES:
        key = f"{f}_avg"
        user_val = user_baseline.get(key) if user_baseline else None
        p = prior.get(f) if prior else None

        if p is None:
            out[key] = float(user_val) if user_val is not None else 0.0
        elif user_val is None:
            out[key] = float(p)
        else:
            out[key] = w_user * float(user_val) + w_prior * float(p)

    out["prior_weight"] = w_prior
    out["age_band"] = get_age_band(age)
    return out