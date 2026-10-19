# api/routers/dashboard.py

import logging
import math
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

import pandas as pd
from fastapi import APIRouter, Depends, Query

BASE_DIR = Path(__file__).resolve().parent.parent.parent
if str(BASE_DIR) not in sys.path:
    sys.path.insert(0, str(BASE_DIR))

from core.config import SESSIONS_TABLE
from core.security import get_current_user_id
from core.supabase_client import get_service_client
from services.suggestions import get_suggestions_for_session
from src.cli_logic import (
    categorize_cli,
    get_training_bounds,
    get_training_weights,
    normalize_with_fixed_bounds,
)
from src.data.supabase_manager import get_or_create_baseline, parse_ts
from src.forecaster import get_7_day_forecast

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/dashboard", tags=["dashboard"])

RAW_COLS = [
    "typing_mean",
    "typing_variance",
    "task_switching",
    "work_duration",
    "late_night",
]

# Cache user profiles for 10 minutes to avoid repeating the Supabase admin lookup.
_PROFILE_CACHE: dict[str, tuple[float, dict]] = {}
_PROFILE_CACHE_TTL_SECONDS = 600


def _num(value, default: float = 0.0) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return default
    return default if (math.isnan(number) or math.isinf(number)) else number


def _clean_row(row: dict) -> dict:
    cleaned = dict(row)
    for key in (
        "typing_mean",
        "typing_variance",
        "task_switching",
        "work_duration",
        "cli_score",
    ):
        cleaned[key] = _num(cleaned.get(key))

    cleaned["late_night"] = 1 if cleaned.get("late_night") else 0
    cleaned["risk_level"] = cleaned.get("risk_level") or "Low"
    return cleaned


def _fetch_sessions(user_id: str, limit: int = 100) -> list[dict]:
    client = get_service_client()
    result = (
        client.table(SESSIONS_TABLE)
        .select("*")
        .eq("user_id", user_id)
        .order("created_at", desc=True)
        .limit(limit)
        .execute()
    )
    return [_clean_row(row) for row in (result.data or [])]


def _user_profile(uid: str) -> dict:
    cached = _PROFILE_CACHE.get(uid)
    if cached and time.time() - cached[0] < _PROFILE_CACHE_TTL_SECONDS:
        return cached[1]

    try:
        client = get_service_client()
        user = client.auth.admin.get_user_by_id(uid).user
        metadata = user.user_metadata or {}
        profile = {
            "uid": uid,
            "email": user.email or "",
            "display_name": (
                metadata.get("display_name")
                or metadata.get("name")
                or ""
            ),
        }
        _PROFILE_CACHE[uid] = (time.time(), profile)
        return profile
    except Exception:
        logger.warning(
            "Could not fetch profile for uid %s; using bare uid",
            uid,
            exc_info=True,
        )
        return {"uid": uid, "email": "", "display_name": ""}


def _to_session_row(row: dict, local_tz: ZoneInfo) -> dict:
    timestamp = row.get("created_at")
    if isinstance(timestamp, str):
        timestamp_dt = parse_ts(timestamp)
    elif isinstance(timestamp, datetime):
        timestamp_dt = timestamp
    else:
        timestamp_dt = datetime.now(timezone.utc)

    # Ensure timestamps without timezone information are treated as UTC.
    if timestamp_dt.tzinfo is None:
        timestamp_dt = timestamp_dt.replace(tzinfo=timezone.utc)

    return {
        "timestamp": (
            timestamp if isinstance(timestamp, str) else timestamp_dt.isoformat()
        ),
        "typing_mean": row["typing_mean"],
        "typing_variance": row["typing_variance"],
        "task_switching": row["task_switching"],
        "work_duration": row["work_duration"],
        "late_night": int(row["late_night"]),
        "hour_of_day": timestamp_dt.astimezone(local_tz).hour,
    }


def _build_trend(rows: list[dict]) -> list[dict]:
    ordered = [row for row in reversed(rows) if row["cli_score"] > 0]
    return [
        {
            "session_index": index,
            "timestamp": row["created_at"],
            "CLI": row["cli_score"],
            "CLI_category": row["risk_level"],
        }
        for index, row in enumerate(ordered)
    ]


def _build_drivers(latest_norm: dict, weights: dict) -> list[dict]:
    """Heuristic ranking of the three largest weighted normalized signals."""
    contributions = {
        "typing_mean": weights["typing_mean_norm"] * latest_norm["typing_mean_norm"],
        "typing_variance": (
            weights["typing_variance_norm"] * latest_norm["typing_variance_norm"]
        ),
        "task_switching": (
            weights["task_switching_norm"] * latest_norm["task_switching_norm"]
        ),
        "work_duration": (
            weights["work_duration_norm"] * latest_norm["work_duration_norm"]
        ),
        "late_night": weights["late_night"] * latest_norm["late_night"],
    }
    labels = {
        "typing_mean": "Typing speed",
        "typing_variance": "Typing irregularity",
        "task_switching": "Task switching",
        "work_duration": "Session length",
        "late_night": "Late-night work",
    }

    ranked = sorted(contributions.items(), key=lambda item: item[1], reverse=True)[:3]
    drivers = []
    for key, contribution in ranked:
        normalized_value = (
            latest_norm["late_night"]
            if key == "late_night"
            else latest_norm[f"{key}_norm"]
        )
        drivers.append(
            {
                "label": labels[key],
                "direction": "up" if normalized_value >= 0.5 else "down",
                "value": f"{normalized_value * 100:.0f}%",
                "caption": "of contribution to current CLI",
                "note": f"Weighted at {contribution * 100:.1f}% of your CLI score",
            }
        )
    return drivers


def _build_compare(latest_row: dict, baseline: dict) -> list[dict]:
    """Compare the latest session with the user's rolling baseline averages."""
    pairs = [
        ("Typing speed", "typing_mean", "typing_mean_avg"),
        ("Task switching", "task_switching", "task_switching_avg"),
        ("Session length", "work_duration", "work_duration_avg"),
    ]
    comparisons = []
    for label, live_key, baseline_key in pairs:
        live_value = _num(latest_row.get(live_key))
        baseline_value = _num(baseline.get(baseline_key))
        delta = live_value - baseline_value
        direction = "up" if delta > 0 else "down" if delta < 0 else "flat"
        comparisons.append(
            {
                "label": label,
                "caption": "vs your rolling average",
                "value": f"{live_value:.1f}",
                "delta": f"{delta:+.1f}",
                "direction": direction,
            }
        )
    return comparisons


def _pct_metrics(latest_norm: dict) -> dict:
    """Heuristic mapping of normalized signals to the dashboard gauges."""
    rest_pct = round((1 - latest_norm["late_night"]) * 100)
    focus_pct = round((1 - latest_norm["task_switching_norm"]) * 100)
    balance_pct = round((1 - latest_norm["work_duration_norm"]) * 100)
    return {
        "rest_pct": rest_pct,
        "focus_pct": focus_pct,
        "balance_pct": balance_pct,
    }


@router.get("")
def get_dashboard(
    tz: str = Query(default="UTC", max_length=64),
    user_id: str = Depends(get_current_user_id),
):
    """Return the authenticated user's dashboard data."""
    try:
        local_tz = ZoneInfo(tz)
    except (ZoneInfoNotFoundError, ValueError, TypeError):
        logger.warning("Invalid timezone %r; falling back to UTC", tz)
        local_tz = ZoneInfo("UTC")

    # Fetch independent Supabase data concurrently.
    with ThreadPoolExecutor(max_workers=3) as pool:
        sessions_future = pool.submit(_fetch_sessions, user_id)
        profile_future = pool.submit(_user_profile, user_id)
        baseline_future = pool.submit(get_or_create_baseline, user_id)

        try:
            rows = sessions_future.result()
        except Exception:
            logger.exception("Could not fetch sessions for %s", user_id)
            raise

        try:
            profile = profile_future.result()
        except Exception:
            logger.exception("Could not fetch profile for %s", user_id)
            profile = {"uid": user_id, "email": "", "display_name": ""}

        try:
            baseline = baseline_future.result() or {}
        except Exception:
            logger.exception("Baseline fetch failed for %s", user_id)
            baseline = {}

    if not rows:
        return {
            "ok": True,
            "user": profile,
            "cli": 0.08,
            "cli_category": "Low",
            "rest_pct": 85,
            "focus_pct": 80,
            "balance_pct": 85,
            "stress_level": "Low",
            "energy_level": "82%",
            "late_night_count": 0,
            "session_count": 0,
            "avg_duration": 0,
            "latest": None,
            "trend": [],
            "forecast": [],
            "suggestions": [],
            "drivers": [],
            "compare": [],
        }

    latest = rows[0]
    now = datetime.now(timezone.utc)
    latest_dt = parse_ts(latest["created_at"])
    if latest_dt.tzinfo is None:
        latest_dt = latest_dt.replace(tzinfo=timezone.utc)

    delta_hours = max(0.0, (now - latest_dt).total_seconds() / 3600.0)
    now_local_date = now.astimezone(local_tz).date()
    latest_local_date = latest_dt.astimezone(local_tz).date()
    is_earlier_day = latest_local_date < now_local_date
    stored_cli = max(0.08, latest["cli_score"])

    if is_earlier_day and delta_hours >= 6.0:
        current_cli, current_category = 0.08, "Low"
    else:
        decay = math.exp(-0.04 * delta_hours)
        decayed = max(0.08, stored_cli * decay)
        max_drop = min(0.020, 0.015 * min(1.5, max(1.0, delta_hours * 6.0)))
        current_cli = round(max(0.08, max(stored_cli - max_drop, decayed)), 3)
        current_category = categorize_cli(current_cli)

    total_work_hours = sum(row["work_duration"] for row in rows[:8])
    local_hour = now.astimezone(local_tz).hour
    circadian_base = (
        84.0 - max(0.0, (local_hour - 8) * 1.2)
        if 8 <= local_hour <= 23
        else 70.0
    )
    energy_value = round(
        max(
            25.0,
            min(
                85.0,
                circadian_base - total_work_hours * 2.5 - current_cli * 25.0,
            ),
        )
    )
    stress_level = (
        "Low"
        if current_cli <= 0.25
        else "Moderate"
        if current_cli <= 0.60
        else "Elevated"
    )

    try:
        weights = get_training_weights()
        bounds = get_training_bounds()
        latest_df = pd.DataFrame([{key: latest[key] for key in RAW_COLS}])
        latest_norm = (
            normalize_with_fixed_bounds(latest_df, bounds)
            .iloc[0]
            .fillna(0.0)
            .to_dict()
        )
        pct = _pct_metrics(latest_norm)
        drivers = _build_drivers(latest_norm, weights)
    except Exception:
        logger.exception("Scoring breakdown failed for %s", user_id)
        pct = {"rest_pct": 0, "focus_pct": 0, "balance_pct": 0}
        drivers = []

    try:
        forecast_df = get_7_day_forecast(current_cli)
        forecast = [
            {"date": date.strftime("%Y-%m-%d"), "CLI": round(float(cli), 3)}
            for date, cli in zip(forecast_df["Date"], forecast_df["CLI"])
        ]
    except Exception:
        logger.exception("Forecast failed for %s", user_id)
        forecast = []

    try:
        signals = {key: latest[key] for key in RAW_COLS}
        suggestions = [
            {"title": suggestion, "body": ""}
            for suggestion in get_suggestions_for_session(
                cli=current_cli, **signals
            )
        ]
    except Exception:
        logger.exception("Suggestions failed for %s", user_id)
        suggestions = []

    return {
        "ok": True,
        "user": profile,
        "cli": current_cli,
        "cli_category": current_category,
        "stress_level": stress_level,
        "energy_level": f"{energy_value}%",
        **pct,
        "late_night_count": sum(row["late_night"] for row in rows),
        "session_count": len(rows),
        "avg_duration": round(
            sum(row["work_duration"] for row in rows) / len(rows), 1
        ),
        "latest": _to_session_row(latest, local_tz),
        "trend": _build_trend(rows),
        "forecast": forecast,
        "suggestions": suggestions,
        "drivers": drivers,
        "compare": _build_compare(latest, baseline) if baseline else [],
    }
