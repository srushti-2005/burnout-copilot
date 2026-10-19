#CLI_LOGIC
import math
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
    Returns (0.0, dataset max) for each raw behavioural feature.

    The upper bound is the training-set maximum (unchanged). The lower bound
    is 0.0, NOT the dataset minimum: real light activity (a few keystrokes,
    a short session) is below the synthetic dataset's minimum and used to be
    clipped to a normalized 0. With a 0.0 floor, zero activity still maps to
    exactly 0.0, so "all stats zero -> CLI zero" holds.
    """
    if path not in _BOUNDS_CACHE:
        df = load_data(path)
        _BOUNDS_CACHE[path] = {
            "typing_mean":     (0.0, float(df["typing_mean"].max())),
            "typing_variance": (0.0, float(df["typing_variance"].max())),
            "task_switching":  (0.0, float(df["task_switching"].max())),
            "work_duration":   (0.0, float(df["work_duration"].max())),
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


# =====================================================================
# Live CLI dynamics (used by supabase_manager.save_session, the dashboard
# endpoint and scripts/recompute_cli.py). The formula above is unchanged;
# everything below only decides how the stored score MOVES between sessions.
# =====================================================================

# Behavioural signals. work_duration is deliberately NOT here: it is elapsed
# time, not load. A window with no typing and no window switching is idle.
SIGNAL_FEATURES = ("typing_mean", "typing_variance", "task_switching")

TAU_UP_MIN = 8.0      # how fast CLI rises toward higher load (minutes)
TAU_DOWN_MIN = 12.0   # how fast CLI falls toward lower load (minutes)
WINDOW_MIN = 5.0      # a session row summarises at most this many minutes
SNAP = 0.005          # fall within this of the target -> land exactly on it


def _f(v, default=0.0):
    try:
        x = float(v)
    except (TypeError, ValueError):
        return default
    return default if (math.isnan(x) or math.isinf(x)) else x


def _clamp01(x):
    return max(0.0, min(1.0, x))


def is_idle(row):
    """True when there is no behavioural signal at all (no typing, no
    variance, no window switches, not late-night). Accepts a dict/Series."""
    if bool(row.get("late_night", 0)):
        return False
    return all(_f(row.get(k)) <= 0.0 for k in SIGNAL_FEATURES)


def instant_cli(row, weights=None, bounds=None):
    """Instantaneous load of ONE session row, using the original CRITIC
    formula (calculate_cli) with fixed training bounds. Idle rows are
    exactly 0.0."""
    if is_idle(row):
        return 0.0
    if weights is None:
        weights = get_training_weights()
    if bounds is None:
        bounds = get_training_bounds()
    df = pd.DataFrame([{
        "typing_mean":     _f(row.get("typing_mean")),
        "typing_variance": _f(row.get("typing_variance")),
        "task_switching":  _f(row.get("task_switching")),
        "work_duration":   _f(row.get("work_duration")),
        "late_night":      int(bool(row.get("late_night", 0))),
    }])
    norm = normalize_with_fixed_bounds(df, bounds).iloc[0]
    return _clamp01(calculate_cli(norm, weights))


def smooth_cli(prev, target, dt_min):
    """Move `prev` toward `target` over `dt_min` minutes.

    Exponential approach with a cap proportional to elapsed time (rise <= 2%
    per minute, fall <= 1% per minute), so the score changes gradually with
    no sudden jumps or drops, and with NO floor: when target is 0 the score
    does reach exactly 0.0 after a realistic rest period."""
    prev = _clamp01(_f(prev))
    target = _clamp01(_f(target))
    dt = _f(dt_min)
    if dt <= 0.0:
        return round(prev, 3)
    dt = min(dt, 24 * 60.0)
    if target >= prev:
        move = (target - prev) * (1.0 - math.exp(-dt / TAU_UP_MIN))
        new = prev + min(move, 0.02 * dt)   # rise: at most 2% per minute
    else:
        move = (prev - target) * (1.0 - math.exp(-dt / TAU_DOWN_MIN))
        new = prev - min(move, 0.01 * dt)   # fall: at most 1% per minute
        if new - target < SNAP:
            new = target
    return round(_clamp01(new), 3)


def next_cli(prev_cli, instant, gap_min):
    """CLI for a new session row.

    prev_cli : previous stored CLI (None if this is the user's first row)
    instant  : this row's instantaneous load
    gap_min  : minutes since the previous row (None if none)

    Time without data first rests the old value toward 0, then the new
    window pulls it toward `instant`. Long gaps (overnight) therefore reset
    naturally; no calendar-day or timezone logic is needed."""
    if prev_cli is None or gap_min is None:
        return smooth_cli(0.0, instant, WINDOW_MIN)
    gap = max(0.0, _f(gap_min))
    base = smooth_cli(prev_cli, 0.0, max(0.0, gap - WINDOW_MIN))
    return smooth_cli(base, instant, min(gap, WINDOW_MIN))


def live_cli(stored_cli, age_min, grace_min):
    """CLI to DISPLAY now: the last stored value, rested toward 0 for the
    time since it was stored (after a grace period covering the normal gap
    between agent uploads)."""
    return smooth_cli(stored_cli, 0.0, max(0.0, _f(age_min) - _f(grace_min)))


def compute_session_cli(row, prev, gap_min, context_multiplier=1.0,
                        weights=None, bounds=None):
    """Full pipeline for one session. `prev` is the previous stored session
    dict (cli_score / cli_score_raw) or None. Returns
    (cli_raw, cli_adjusted, risk_level)."""
    inst_raw = instant_cli(row, weights, bounds)
    mult = _f(context_multiplier, 1.0)
    inst_adj = _clamp01(inst_raw * mult)
    if prev is None:
        p_adj = p_raw = None
    else:
        p_adj = _f(prev.get("cli_score"))
        p_raw = _f(prev.get("cli_score_raw"), p_adj) if prev.get("cli_score_raw") is not None else p_adj
    cli_raw = next_cli(p_raw, inst_raw, gap_min)
    cli_adj = next_cli(p_adj, inst_adj, gap_min)
    return cli_raw, cli_adj, categorize_cli(cli_adj)
