# api/routers/dashboard.py
import logging
import sys
from pathlib import Path
from datetime import datetime, timezone

from fastapi import APIRouter, Depends

BASE_DIR = Path(__file__).resolve().parent.parent.parent
if str(BASE_DIR) not in sys.path:
    sys.path.insert(0, str(BASE_DIR))

from core.supabase_client import get_service_client
from core.config import SESSIONS_TABLE
from core.security import get_current_user_id
from src.data.supabase_manager import get_or_create_baseline
from src.forecaster import get_7_day_forecast
from src.cli_logic import get_training_weights, get_training_bounds, normalize_with_fixed_bounds, categorize_cli
from services.suggestions import get_suggestions_for_session
import pandas as pd

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/dashboard", tags=["dashboard"])

RAW_COLS = ["typing_mean", "typing_variance", "task_switching", "work_duration", "late_night"]


def _fetch_sessions(user_id: str, limit: int = 100) -> list[dict]:
    client = get_service_client()
    result = (
        client.table(SESSIONS_TABLE).select("*")
        .eq("user_id", user_id).order("created_at", desc=True)
        .limit(limit).execute()
    )
    return result.data or []


def _user_profile(uid: str) -> dict:
    """Best-effort lookup via the service-role admin API. Falls back to bare uid
    if the admin call fails (e.g. key lacks admin scope) — dashboard should still render."""
    try:
        client = get_service_client()
        res = client.auth.admin.get_user_by_id(uid)
        user = res.user
        meta = user.user_metadata or {}
        return {
            "uid": uid,
            "email": user.email or "",
            "display_name": meta.get("display_name") or meta.get("name") or "",
        }
    except Exception:
        logger.warning("Could not fetch profile for uid %s, using bare uid", uid)
        return {"uid": uid, "email": "", "display_name": ""}


def _to_session_row(row: dict) -> dict:
    ts = row["created_at"]
    if isinstance(ts, str):
        ts_dt = datetime.fromisoformat(ts.replace("Z", "+00:00"))
    else:
        ts_dt = ts
    return {
        "timestamp": ts if isinstance(ts, str) else ts_dt.isoformat(),
        "typing_mean": row["typing_mean"],
        "typing_variance": row["typing_variance"],
        "task_switching": row["task_switching"],
        "work_duration": row["work_duration"],
        "late_night": int(row["late_night"]),
        # not stored per-session anywhere upstream — derived from the timestamp
        "hour_of_day": ts_dt.astimezone(timezone.utc).hour,
    }


def _build_trend(rows: list[dict]) -> list[dict]:
    # rows are newest-first from the query; trend should read oldest -> newest
    ordered = list(reversed(rows))
    return [
        {
            "session_index": i,
            "timestamp": r["created_at"],
            "CLI": r["cli_score"],
            "CLI_category": r["risk_level"],
        }
        for i, r in enumerate(ordered)
    ]


def _build_drivers(latest_norm: dict, weights: dict) -> list[dict]:
    """
    HEURISTIC — not derived from an existing function. Ranks the 3 features
    contributing most to the latest CLI score (weight x normalized value),
    labelled with plain-English direction. Tune freely; nothing downstream
    in cli_logic.py depends on this shape.
    """
    contributions = {
        "typing_mean": weights["typing_mean_norm"] * latest_norm["typing_mean_norm"],
        "typing_variance": weights["typing_variance_norm"] * latest_norm["typing_variance_norm"],
        "task_switching": weights["task_switching_norm"] * latest_norm["task_switching_norm"],
        "work_duration": weights["work_duration_norm"] * latest_norm["work_duration_norm"],
        "late_night": weights["late_night"] * latest_norm["late_night"],
    }
    labels = {
        "typing_mean": "Typing speed",
        "typing_variance": "Typing irregularity",
        "task_switching": "Task switching",
        "work_duration": "Session length",
        "late_night": "Late-night work",
    }
    ranked = sorted(contributions.items(), key=lambda kv: kv[1], reverse=True)[:3]
    out = []
    for key, val in ranked:
        norm_val = latest_norm[f"{key}_norm"] if key != "late_night" else latest_norm["late_night"]
        direction = "up" if norm_val >= 0.5 else "down"
        out.append({
            "label": labels[key],
            "direction": direction,
            "value": f"{norm_val * 100:.0f}%",
            "caption": "of contribution to current CLI",
            "note": f"Weighted at {contributions[key] * 100:.1f}% of your CLI score",
        })
    return out


def _build_compare(latest_row: dict, baseline: dict) -> list[dict]:
    """HEURISTIC — compares latest session to the user's rolling baseline averages."""
    pairs = [
        ("Typing speed", "typing_mean", "typing_mean_avg"),
        ("Task switching", "task_switching", "task_switching_avg"),
        ("Session length", "work_duration", "work_duration_avg"),
    ]
    out = []
    for label, live_key, base_key in pairs:
        live_val = latest_row[live_key]
        base_val = baseline.get(base_key, 0) or 0
        delta = live_val - base_val
        direction = "up" if delta > 0 else "down" if delta < 0 else "flat"
        out.append({
            "label": label,
            "caption": "vs your rolling average",
            "value": f"{live_val:.1f}",
            "delta": f"{delta:+.1f}",
            "direction": direction,
        })
    return out


def _pct_metrics(latest_norm: dict) -> dict:
    """
    HEURISTIC mapping onto rest/focus/balance percentages for the UI gauges.
    rest_pct: inverse of late-night work. focus_pct: inverse of task-switching.
    balance_pct: inverse of work-duration extremity. All 0-100.
    """
    rest_pct = round((1 - latest_norm["late_night"]) * 100)
    focus_pct = round((1 - latest_norm["task_switching_norm"]) * 100)
    balance_pct = round((1 - latest_norm["work_duration_norm"]) * 100)
    return {"rest_pct": rest_pct, "focus_pct": focus_pct, "balance_pct": balance_pct}


@router.get("")
def get_dashboard(user_id: str = Depends(get_current_user_id)):
    """
    Identity comes ONLY from the verified Supabase token, the same way
    /twin and /focus/* already work. There is no uid query param, so a
    caller can never read someone else's dashboard by guessing an id.
    """
    rows = _fetch_sessions(user_id)
    if not rows:
        return {
            "ok": True,
            "user": _user_profile(user_id),
            "cli": 0.08, "cli_category": "Low", "rest_pct": 85, "focus_pct": 80, "balance_pct": 85,
            "stress_level": "Low", "energy_level": "82%",
            "late_night_count": 0, "session_count": 0, "avg_duration": 0,
            "latest": None, "trend": [], "forecast": [], "suggestions": [],
            "drivers": [], "compare": [],
        }

    latest = rows[0]
    weights = get_training_weights()
    bounds = get_training_bounds()

    # Calculate live time-decayed CLI for the user's current moment
    import math
    ts = latest["created_at"]
    if isinstance(ts, str):
        latest_dt = datetime.fromisoformat(ts.replace("Z", "+00:00"))
    else:
        latest_dt = ts
    now = datetime.now(timezone.utc)
    delta_hours = max(0.0, (now - latest_dt).total_seconds() / 3600.0)
    is_earlier_day = (latest_dt.date() < now.date())

    stored_cli = max(0.08, float(latest.get("cli_score") or 0.08))

    # Morning reset: only after overnight sleep (>= 6 hours gap on an earlier calendar day)
    if is_earlier_day and delta_hours >= 6.0:
        current_cli = 0.08
        current_category = "Low"
    else:
        # Same day: slow, continuous, realistic rest decay (e^(-0.04 * delta_hours))
        # Rate-limited so live refreshing decays smoothly by at most 1-2%
        decay = math.exp(-0.04 * delta_hours)
        decayed = max(0.08, stored_cli * decay)
        max_drop = min(0.020, 0.015 * min(1.5, max(1.0, delta_hours * 6.0)))
        current_cli = round(max(0.08, max(stored_cli - max_drop, decayed)), 3)
        current_category = categorize_cli(current_cli)

    # Realistic circadian Energy and Mental Load calculation
    # Energy is not a naive (100 - CLI); a conscious human being reading or working is never at 100%.
    # Factored with circadian hour of day, cumulative work duration, and cognitive load.
    total_work_hours = sum(float(r.get("work_duration") or 0.0) for r in rows[:8])
    hour = now.hour
    circadian_base = 84.0 - max(0.0, (hour - 8) * 1.2) if 8 <= hour <= 23 else 70.0
    energy_val = round(max(25.0, min(85.0, circadian_base - (total_work_hours * 2.5) - (current_cli * 25.0))))
    energy_str = f"{energy_val}%"

    if current_cli <= 0.25:
        stress_str = "Low"
    elif current_cli <= 0.60:
        stress_str = "Moderate"
    else:
        stress_str = "Elevated"

    latest_df = pd.DataFrame([{k: latest[k] for k in RAW_COLS}])
    latest_df_norm = normalize_with_fixed_bounds(latest_df, bounds).iloc[0]
    latest_norm = latest_df_norm.to_dict()

    try:
        baseline = get_or_create_baseline(user_id) or {}
    except Exception:
        logger.exception("Baseline fetch failed for %s, continuing without it", user_id)
        baseline = {}

    try:
        forecast_df = get_7_day_forecast(current_cli)
        forecast = [
            {"date": d.strftime("%Y-%m-%d"), "CLI": round(float(c), 3)}
            for d, c in zip(forecast_df["Date"], forecast_df["CLI"])
        ]
    except Exception:
        logger.exception("Forecast failed for %s", user_id)
        forecast = []

    try:
        signals = {k: latest[k] for k in RAW_COLS}
        suggestion_texts = get_suggestions_for_session(cli=current_cli, **signals)
        suggestions = [{"title": s, "body": ""} for s in suggestion_texts]
    except Exception:
        logger.exception("Suggestions failed for %s", user_id)
        suggestions = []

    late_night_count = sum(1 for r in rows if int(r["late_night"]) == 1)
    avg_duration = round(sum(r["work_duration"] for r in rows) / len(rows), 1)

    return {
        "ok": True,
        "user": _user_profile(user_id),
        "cli": current_cli,
        "cli_category": current_category,
        "stress_level": stress_str,
        "energy_level": energy_str,
        **_pct_metrics(latest_norm),
        "late_night_count": late_night_count,
        "session_count": len(rows),
        "avg_duration": avg_duration,
        "latest": _to_session_row(latest),
        "trend": _build_trend(rows),
        "forecast": forecast,
        "suggestions": suggestions,
        "drivers": _build_drivers(latest_norm, weights),
        "compare": _build_compare(latest, baseline) if baseline else [],
    }