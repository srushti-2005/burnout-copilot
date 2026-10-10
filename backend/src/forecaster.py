# src/forecaster.py
"""
Short-term CLI projection (visualisation only).

This is NOT a trained or validated forecasting model. It starts from the
current CLI, adds a small upward drift plus bounded random perturbation,
and clips to [0, 1]. Do not describe it as forecasting/prediction in the
UI, API or paper -- use "projection".
"""

import hashlib

import numpy as np
import pandas as pd

TREND_PER_DAY = 0.015   # small upward drift per day
NOISE_BOUND = 0.01      # uniform noise in [-0.01, +0.01]
HORIZON_DAYS = 7


def stable_seed(*parts) -> int:
    """Deterministic seed that is identical across processes/restarts
    (unlike Python's built-in hash(), which is salted per process)."""
    key = "_".join(str(p) for p in parts)
    return int(hashlib.sha256(key.encode()).hexdigest()[:8], 16)


def project_cli_7d(current_cli, seed: int | None = None) -> pd.DataFrame:
    """Return a 7-day short-term CLI projection as a DataFrame (Date, CLI).

    Illustrative trend + bounded noise; not a trained or validated forecaster.

    Parameters
    ----------
    current_cli : float
        Latest CLI score (falls back to 0.5 if not numeric).
    seed : int | None
        Pass stable_seed(user_id, date_string) to tie the projection to a user/day.
        If None, the seed is derived (SHA-256) from (current_cli, today's date):
        the projection is deterministic for the same CLI value on the same
        calendar date, and will differ on a different date or CLI value.
    """
    try:
        current_cli = float(current_cli)
    except (ValueError, TypeError):
        current_cli = 0.5

    if seed is None:
        seed = stable_seed(round(current_cli, 6), pd.Timestamp.now().date())
    rng = np.random.default_rng(seed)

    dates = pd.date_range(
        start=pd.Timestamp.now().normalize() + pd.Timedelta(days=1),
        periods=HORIZON_DAYS,
    )

    values = [
        float(np.clip(
            current_cli + i * TREND_PER_DAY + rng.uniform(-NOISE_BOUND, NOISE_BOUND),
            0.0, 1.0,
        ))
        for i in range(HORIZON_DAYS)
    ]

    return pd.DataFrame({"Date": dates, "CLI": values})


# Backward-compatible alias so existing callers keep working while you rename
# them. Delete this alias once `grep -rn get_7_day_forecast` returns nothing.
def get_7_day_forecast(current_cli, seed: int | None = None) -> pd.DataFrame:
    return project_cli_7d(current_cli, seed=seed)