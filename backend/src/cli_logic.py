#CLI_LOGIC
import os
import pandas as pd
import numpy as np


_THIS_DIR          = os.path.dirname(os.path.abspath(__file__))
_PROJECT_ROOT       = os.path.dirname(_THIS_DIR)
DEFAULT_DATA_PATH  = os.path.join(_PROJECT_ROOT, "data", "raw", "burnout_dataset.csv")


def load_data(path=DEFAULT_DATA_PATH):
    df = pd.read_csv(path)
    df["timestamp"] = pd.to_datetime(df["timestamp"])
    df = df.sort_values(["user_id", "timestamp"])
    return df


def min_max_scale(series):
    """Safe min-max scale. Returns a Series of 0s if all values are identical."""
    mn, mx = series.min(), series.max()
    if mx == mn:
        return pd.Series(0.0, index=series.index)
    return (series - mn) / (mx - mn)


def normalize_features(df):
    df = df.copy()
    df["typing_mean_norm"]     = min_max_scale(df["typing_mean"])
    df["typing_variance_norm"] = min_max_scale(df["typing_variance"])
    df["task_switching_norm"]  = min_max_scale(df["task_switching"])
    df["work_duration_norm"]   = min_max_scale(df["work_duration"])
    return df


def compute_critic_weights(df):
    """
    UNCHANGED from the original implementation. CRITIC method: weights
    based on standard deviation x information content (sum of
    (1 - |correlation|) for each feature pair). Falls back to equal
    weights when there is no variance in the data.
    """
    cols = [
        "typing_mean_norm",
        "typing_variance_norm",
        "task_switching_norm",
        "work_duration_norm",
        "late_night",
    ]

    missing = [c for c in cols if c not in df.columns]
    if missing:
        return {col: 1 / len(cols) for col in cols}

    data = df[cols].copy().astype(float)

    std_dev = data.std(ddof=1)
    corr    = data.corr()
    corr = corr.fillna(0)

    C = {}
    for col in cols:
        info = sum(1 - abs(corr.loc[col, other]) for other in cols)
        C[col] = std_dev[col] * info

    total = sum(C.values())

    if total == 0 or pd.isna(total):
        return {col: 1 / len(cols) for col in cols}

    weights = {k: C[k] / total for k in C}
    weights = {k: (v if not pd.isna(v) else 1 / len(cols)) for k, v in weights.items()}

    return weights


_WEIGHTS_CACHE = {}


def get_training_weights(path=DEFAULT_DATA_PATH):
    """
    UNCHANGED. Returns the CRITIC-derived feature weights computed ONCE
    from the full training dataset, cached for the process lifetime.
    """
    if path not in _WEIGHTS_CACHE:
        df = load_data(path)
        df = normalize_features(df)
        _WEIGHTS_CACHE[path] = compute_critic_weights(df)
    return _WEIGHTS_CACHE[path]


_BOUNDS_CACHE = {}


def get_training_bounds(path=DEFAULT_DATA_PATH):
    """
    UNCHANGED. Returns the min/max of each raw behavioural feature from
    the FULL training dataset -- the fixed reference frame for live
    normalization.
    """
    if path not in _BOUNDS_CACHE:
        df = load_data(path)
        _BOUNDS_CACHE[path] = {
            "typing_mean":     (float(df["typing_mean"].min()),     float(df["typing_mean"].max())),
            "typing_variance": (float(df["typing_variance"].min()), float(df["typing_variance"].max())),
            "task_switching":  (float(df["task_switching"].min()),  float(df["task_switching"].max())),
            "work_duration":   (float(df["work_duration"].min()),   float(df["work_duration"].max())),
        }
    return _BOUNDS_CACHE[path]


def normalize_with_fixed_bounds(df, bounds=None):
    """UNCHANGED."""
    if bounds is None:
        bounds = get_training_bounds()
    df = df.copy()

    def _scale(series, mn, mx):
        if mx == mn:
            return pd.Series(0.0, index=series.index)
        return ((series - mn) / (mx - mn)).clip(0.0, 1.0)

    df["typing_mean_norm"]     = _scale(df["typing_mean"],     *bounds["typing_mean"])
    df["typing_variance_norm"] = _scale(df["typing_variance"], *bounds["typing_variance"])
    df["task_switching_norm"]  = _scale(df["task_switching"],  *bounds["task_switching"])
    df["work_duration_norm"]   = _scale(df["work_duration"],   *bounds["work_duration"])
    return df


def calculate_cli(row, weights):
    """
    COMPLETELY UNCHANGED -- this is the core behavioral CLI number.
    Age is NEVER passed to this function and NEVER appears in this
    formula, by design (age provides context, it does not determine
    burnout risk).
    """
    cli = (
        weights["typing_mean_norm"]     * row["typing_mean_norm"]     +
        weights["typing_variance_norm"] * row["typing_variance_norm"] +
        weights["task_switching_norm"]  * row["task_switching_norm"]  +
        weights["work_duration_norm"]   * row["work_duration_norm"]   +
        weights["late_night"]           * row["late_night"]
    )
    return round(float(cli), 3)


def categorize_cli(cli, age: int | None = None):
    """
    Fixed thresholds for every user: Low < 0.4 <= Medium < 0.7 <= High.

    `age` is accepted ONLY so older callers that still pass it do not
    break. It is DEPRECATED and IGNORED: age never changes a CLI
    category. Age is used solely as a prior for the personalized
    baseline (src/personalization/baseline_prior.py).
    """
    medium_threshold, high_threshold = 0.4, 0.7

    if cli < medium_threshold:
        return "Low"
    elif cli < high_threshold:
        return "Medium"
    else:
        return "High"


def add_cli(df):
    """UNCHANGED -- batch/offline use, no age available per-row here."""
    df      = df.copy()
    weights = compute_critic_weights(df)
    df["CLI"]          = df.apply(lambda row: calculate_cli(row, weights), axis=1)
    df["CLI_category"] = df["CLI"].apply(categorize_cli)
    return df


def load_and_process(path=DEFAULT_DATA_PATH):
    """UNCHANGED."""
    df = load_data(path)
    df = normalize_features(df)
    df = add_cli(df)
    return df


def simulate_scenario(input_data, path=DEFAULT_DATA_PATH, age: int | None = None):
    """
    UNCHANGED numerically. `age` is accepted for backward compatibility
    but is DEPRECATED and IGNORED (see categorize_cli).
    """
    df = load_data(path)
    df = normalize_features(df)

    weights = compute_critic_weights(df)

    def scale(value, column):
        mn, mx = df[column].min(), df[column].max()
        if mx == mn:
            return 0.0
        return (value - mn) / (mx - mn)

    typing_mean_norm     = scale(input_data["typing_mean"],     "typing_mean")
    typing_variance_norm = scale(input_data["typing_variance"], "typing_variance")
    task_switching_norm  = scale(input_data["task_switching"],  "task_switching")
    work_duration_norm   = scale(input_data["work_duration"],   "work_duration")

    cli = (
        weights["typing_mean_norm"]     * typing_mean_norm     +
        weights["typing_variance_norm"] * typing_variance_norm +
        weights["task_switching_norm"]  * task_switching_norm  +
        weights["work_duration_norm"]   * work_duration_norm   +
        weights["late_night"]           * input_data["late_night"]
    )

    cli = round(float(cli), 3)
    return cli, categorize_cli(cli)