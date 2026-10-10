"""
Personalized Burnout Digital Twin.

Combines:  Profile (age) + Baseline + Current State + Deviations
           + Historical State (CLI / risk history) + Trends

build_digital_twin() is a PURE function (no I/O) so it is easy to test.
load_digital_twin() is the only function that touches the database.
"""
from __future__ import annotations

import logging
import math
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

BASE_DIR = Path(__file__).resolve().parent.parent.parent  # project root
if str(BASE_DIR) not in sys.path:
    sys.path.insert(0, str(BASE_DIR))

from core.config import SESSIONS_TABLE
from core.supabase_client import get_service_client
from src.data.supabase_manager import (
    get_or_create_baseline,
    get_profile,
    MIN_SESSIONS_FOR_BASELINE,
)

logger = logging.getLogger(__name__)

# Real column names in the `sessions` table
SESSION_USER_COL = "user_id"
SESSION_TIME_COL = "created_at"
CLI_COL = "cli_score"          # fraction, 0..1
CLI_CATEGORY_COL = "risk_level"

FEATURES = ["typing_mean", "typing_variance", "task_switching", "work_duration", "late_night"]

HISTORY_SESSIONS = 30       # sessions loaded for history / trends
RECENT_SESSIONS = 10        # sessions echoed back in the response
TREND_WINDOW = 4            # last N values used for a trend
TREND_THRESHOLD = 0.10      # >10% total change across the window = not "stable"
DEVIATION_THRESHOLD = 0.15  # >15% away from baseline = above/below normal


def _num(value: Any) -> Optional[float]:
    try:
        f = float(value)
    except (TypeError, ValueError):
        return None
    return None if math.isnan(f) or math.isinf(f) else f


def _round(value: Optional[float], digits: int = 3) -> Optional[float]:
    return None if value is None else round(value, digits)


def compute_trend(values: list[Any]) -> dict:
    """
    Least-squares slope over values (oldest -> newest).
    Example: 18 -> 22 -> 27 -> 34 is "increasing" (about +63% of the mean).
    Needs at least 3 numeric points.
    """
    vals = [v for v in (_num(x) for x in values) if v is not None]
    n = len(vals)
    if n < 3:
        return {"direction": "insufficient_data", "change_pct": None, "values": vals}

    x_mean = (n - 1) / 2
    y_mean = sum(vals) / n
    denom = sum((i - x_mean) ** 2 for i in range(n))
    slope = sum((i - x_mean) * (v - y_mean) for i, v in enumerate(vals)) / denom

    relative = (slope * (n - 1)) / max(abs(y_mean), 1e-9)
    if relative > TREND_THRESHOLD:
        direction = "increasing"
    elif relative < -TREND_THRESHOLD:
        direction = "decreasing"
    else:
        direction = "stable"

    return {
        "direction": direction,
        "change_pct": _round(relative * 100, 1),
        "values": [_round(v) for v in vals],
    }


def build_baseline(baseline_row: Optional[dict]) -> dict:
    """Shape the user_baselines row (typing_mean_avg, ..., session_count)."""
    count = 0
    if baseline_row:
        try:
            count = int(baseline_row.get("session_count") or 0)
        except (TypeError, ValueError):
            count = 0
    established = count >= MIN_SESSIONS_FOR_BASELINE
    averages: dict[str, Optional[float]] = {}
    if established and baseline_row:
        averages = {f: _round(_num(baseline_row.get(f"{f}_avg"))) for f in FEATURES}
    return {"is_established": established, "session_count": count, "averages": averages}


def compute_deviations(current: Optional[dict], baseline: dict) -> dict:
    if not current or not baseline.get("is_established"):
        return {}

    out: dict[str, dict] = {}
    for feat in FEATURES:
        cur = _num(current.get(feat))
        base = _num(baseline["averages"].get(feat))
        if cur is None or base is None:
            continue

        diff = cur - base
        pct = None if abs(base) < 1e-9 else diff / base
        if pct is None:
            status = "above_normal" if diff > 0 else "normal"
        elif pct > DEVIATION_THRESHOLD:
            status = "above_normal"
        elif pct < -DEVIATION_THRESHOLD:
            status = "below_normal"
        else:
            status = "normal"

        out[feat] = {
            "current": _round(cur),
            "baseline": _round(base),
            "difference": _round(diff),
            "difference_pct": _round(pct * 100, 1) if pct is not None else None,
            "status": status,
        }
    return out


def build_digital_twin(
    user_id: str,
    profile: Optional[dict],
    baseline_row: Optional[dict],
    sessions_desc: list[dict],
) -> dict:
    """sessions_desc is NEWEST FIRST, exactly as fetched from the database."""
    sessions = list(reversed(sessions_desc))  # oldest -> newest
    latest = sessions[-1] if sessions else None

    baseline = build_baseline(baseline_row)

    current_state = None
    if latest:
        current_state = {f: _num(latest.get(f)) for f in FEATURES}
        current_state["cli"] = _num(latest.get(CLI_COL))
        current_state["risk_level"] = latest.get(CLI_CATEGORY_COL)
        current_state["recorded_at"] = latest.get(SESSION_TIME_COL)

    cli_history = [_num(s.get(CLI_COL)) for s in sessions]
    numeric_cli = [c for c in cli_history if c is not None]

    historical_state = {
        "session_count": len(sessions),
        "cli_history": [_round(c) for c in cli_history],
        "risk_history_pct": [_round(c * 100, 1) if c is not None else None for c in cli_history],
        "average_cli": _round(sum(numeric_cli) / len(numeric_cli)) if numeric_cli else None,
        "peak_cli": _round(max(numeric_cli)) if numeric_cli else None,
        "recent_sessions": [
            {
                "recorded_at": s.get(SESSION_TIME_COL),
                "cli": _num(s.get(CLI_COL)),
                "risk_level": s.get(CLI_CATEGORY_COL),
                **{f: _num(s.get(f)) for f in FEATURES},
            }
            for s in sessions[-RECENT_SESSIONS:]
        ],
    }

    trends = {
        feat: compute_trend([s.get(feat) for s in sessions[-TREND_WINDOW:]])
        for feat in FEATURES
    }
    trends["cli"] = compute_trend(cli_history[-TREND_WINDOW:])

    return {
        "user_id": user_id,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "profile": {"age": (profile or {}).get("age")},
        "baseline": baseline,
        "current_state": current_state,
        "deviations": compute_deviations(current_state, baseline),
        "historical_state": historical_state,
        "trends": trends,
    }


def load_digital_twin(user_id: str) -> dict:
    profile = None
    try:
        profile = get_profile(user_id)
    except Exception:
        logger.exception("Digital twin: could not load profile for %s", user_id)

    baseline_row = None
    try:
        baseline_row = get_or_create_baseline(user_id)
    except Exception:
        logger.exception("Digital twin: could not load baseline for %s", user_id)

    client = get_service_client()
    result = (
        client.table(SESSIONS_TABLE)
        .select("*")
        .eq(SESSION_USER_COL, user_id)
        .order(SESSION_TIME_COL, desc=True)
        .limit(HISTORY_SESSIONS)
        .execute()
    )
    return build_digital_twin(user_id, profile, baseline_row, result.data or [])
