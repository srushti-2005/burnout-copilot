"""
Wraps your real src/cli_logic.py instead of reimplementing it — this
guarantees FastAPI produces IDENTICAL CLI scores to your Streamlit
dashboard for the same input, since both call the same functions.
cli_logic.py handles its own weight/bounds caching internally
(_WEIGHTS_CACHE, _BOUNDS_CACHE) — no separate cache file needed here.

Age is NOT used here: compute_cli_score() still accepts an optional `age`
so existing callers keep working, but it is ignored. The CLI number and the
Low/Medium/High category use the same fixed thresholds for every user, which
keeps /predict and /suggestions in agreement with /sessions. Age is only used
as a prior for the personalized baseline (src/personalization/baseline_prior.py).
"""
import sys
from pathlib import Path
import pandas as pd

BASE_DIR = Path(__file__).resolve().parent.parent.parent  # burnout-project root
SRC_DIR = BASE_DIR / "src"
if str(SRC_DIR) not in sys.path:
    sys.path.insert(0, str(SRC_DIR))

from cli_logic import (
    get_training_weights,
    get_training_bounds,
    normalize_with_fixed_bounds,
    calculate_cli,
    categorize_cli,
)

FEATURES = ["typing_mean", "typing_variance", "task_switching", "work_duration", "late_night"]


def compute_cli_score(signals: dict, age: int | None = None) -> tuple[float, str]:
    """
    age: DEPRECATED and ignored. Kept only so existing callers that still pass
    it do not break; it never affects the CLI score or the risk category.
    """
    weights = get_training_weights()
    bounds = get_training_bounds()
    row = pd.DataFrame([signals])
    row_norm = normalize_with_fixed_bounds(row, bounds).iloc[0]
    cli = calculate_cli(row_norm, weights)
    category = categorize_cli(cli)
    return cli, category.lower()