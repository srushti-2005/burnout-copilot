# api/routers/dashboard.py
import logging
import math
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends

BASE_DIR = Path(__file__).resolve().parent.parent.parent
if str(BASE_DIR) not in sys.path:
    sys.path.insert(0, str(BASE_DIR))

from core.supabase_client import get_service_client
from core.config import SESSIONS_TABLE
from core.security import get_current_user_id
from src.data.supabase_manager import get_or_create_baseline, parse_ts
from src.forecaster import get_7_day_forecast
from src.cli_logic import (
    get_training_weights, get_training_bounds, normalize_with_fixed_bounds,
    categorize_cli, live_cli,
)
from services.suggestions import get_suggestions_for_session
import pandas as pd

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/dashboard", tags=["dashboard"])

RAW_COLS = ["typing_mean", "typing_variance", "task_switching", "work_duration", "late_night"]
NUM_COLS = ("typing_mean", "typing_variance", "task_switching", "work_duration", "cli_score")


# ── cleaning ────────────────────────────────────────────────────────────
def _num(v, default=0.0) -> float:
    try:
        f = float(v)
    except (TypeError, ValueError):
        return default
    return default if (math.isnan(f) or math.isinf(f)) else f


def _clean_row(r: dict) -> dict:
    """One bad/NULL column must never turn /dashboard into a 500."""
    r = dict(r)
    for k in NUM_COLS:
        r[k] = _num(r.get(k))
    r["late_night"] = 1 if r.get("late_night") else 0
    r["risk_level"] = r.get("risk_level") or "Low"
    return r


def _fetch_sessions(user_id: str, limit: int = 100) -> list[dict]:
    client = get_service_client()
    result = (
        client.table(SESSIONS_TABLE).select("*")
        .eq("user_id", user_id).order("created_at", desc=True)
        .limit(limit).execute()
    )
    return [_clean_row(r) for r in (result.data or [])]


# ── profile (cached: the admin lookup is a slow extra network call) ─────
_PROFILE_CACHE: dict[str, tuple[float, dict]] = {}
_PROFILE_TTL_SECONDS = 600


def _user_profile(uid: str) -> dict:
    hit = _PROFILE_CACHE.get(uid)
    if hit and time.time() - hit[0] < _PROFILE_TTL_SECONDS:
        return hit[1]
    try:
        client = get_service_client()
        user = client.auth.admin.get_user_by_id(uid).user
        meta = user.user_metadata or {}
        prof = {
            "uid": uid,
            "email": user.email or "",
            "display_name": meta.get("display_name") or meta.get("name") or "",
        }
        _PROFILE_CACHE[uid] = (time.time(), prof)
        return prof
    except Exception:
        logger.warning("Could not fetch profile for uid %s, using bare uid", uid)
        return {"uid": uid, "email": "", "display_name": ""}


# ── builders ────────────────────────────────────────────────────────────
def _to_session_row(row: dict, tz: ZoneInfo) -> dict:
    ts_dt = parse_ts(row["created_at"])
    return {
        "timestamp": ts_dt.isoformat(),
        "typing_mean": row["typing_mean"],
        "typing_variance": row["typing_variance"],
        "task_switching": row["task_switching"],
        "work_duration": row["work_duration"],
        "late_night": int(row["late_night"]),
        # derived from the timestamp, in the USER's timezone
        "hour_of_day": ts_dt.astimezone(tz).hour,
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
    HEURISTIC. Ranks the 3 features contributing most to the latest CLI
    score (weight x normalized value), labelled with plain-English direction.
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
    """HEURISTIC: compares latest session to the user's rolling baseline averages."""
    pairs = [
        ("Typing speed", "typing_mean", "typing_mean_avg"),
        ("Task switching", "task_switching", "task_switching_avg"),
        ("Session length", "work_duration", "work_duration_avg"),
    ]
    out = []
    for label, live_key, base_key in pairs:
        live_val = latest_row[live_key]
        base_val = _num(baseline.get(base_key, 0))
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
    """HEURISTIC rest/focus/balance percentages for the UI gauges (0-100)."""
    rest_pct = round((1 - latest_norm["late_night"]) * 100)
    focus_pct = round((1 - latest_norm["task_switching_norm"]) * 100)
    balance_pct = round((1 - latest_norm["work_duration_norm"]) * 100)
    return {"rest_pct": rest_pct, "focus_pct": focus_pct, "balance_pct": balance_pct}


def _grace_minutes(rows: list[dict]) -> float:
    """How long after the last upload we still show the stored CLI as-is:
    1.5x the user's normal upload interval (measured from the last two
    rows), between 3 and 30 minutes."""
    if len(rows) < 2:
        return 5.0
    try:
        gap = abs((parse_ts(rows[0]["created_at"]) - parse_ts(rows[1]["created_at"])).total_seconds()) / 60.0
    except Exception:
        return 5.0
    return min(30.0, max(3.0, 1.5 * gap))


def _energy(now_local_hour: int, total_work_hours: float, cli: float) -> int:
    """Circadian energy in the USER's local time, never above 85%."""
    if 8 <= now_local_hour <= 23:
        circadian_base = 84.0 - max(0.0, (now_local_hour - 8) * 1.2)
    else:
        circadian_base = 70.0
    return round(max(25.0, min(85.0, circadian_base - total_work_hours * 2.5 - cli * 25.0)))


# ── endpoint ────────────────────────────────────────────────────────────
@router.get("")
def get_dashboard(tz: str = "UTC", user_id: str = Depends(get_current_user_id)):
    """
    Identity comes ONLY from the verified Supabase token. `tz` (an IANA name
    such as Asia/Kolkata) only affects time-of-day displays, never identity.
    """
    try:
        local_tz = ZoneInfo(tz)
    except Exception:
        local_tz = ZoneInfo("UTC")

    with ThreadPoolExecutor(max_workers=3) as pool:
        f_rows = pool.submit(_fetch_sessions, user_id)
        f_profile = pool.submit(_user_profile, user_id)
        f_base = pool.submit(get_or_create_baseline, user_id)
        rows = f_rows.result()
        profile = f_profile.result()
        try:
            baseline = f_base.result() or {}
        except Exception:
            logger.exception("Baseline fetch failed for %s, continuing without it", user_id)
            baseline = {}

    now = datetime.now(timezone.utc)
    local_hour = now.astimezone(local_tz).hour

    if not rows:
        return {
            "ok": True, "user": profile,
            "cli": 0.0, "cli_category": "Low", "rest_pct": 85, "focus_pct": 80, "balance_pct": 85,
            "stress_level": "Low", "energy_level": f"{_energy(local_hour, 0.0, 0.0)}%",
            "late_night_count": 0, "session_count": 0, "avg_duration": 0,
            "latest": None, "trend": [], "forecast": [], "suggestions": [],
            "drivers": [], "compare": [],
        }

    latest = rows[0]
    latest_dt = parse_ts(latest["created_at"])
    age_min = max(0.0, (now - latest_dt).total_seconds() / 60.0)

    # Stored CLI, rested toward 0 for the time since the last upload. No floor:
    # a user with no activity really does read 0.
    current_cli = live_cli(latest["cli_score"], age_min, _grace_minutes(rows))
    current_category = categorize_cli(current_cli)

    total_work_hours = sum(r["work_duration"] for r in rows[:8])
    energy_val = _energy(local_hour, total_work_hours, current_cli)
    stress_str = "Low" if current_cli <= 0.25 else "Moderate" if current_cli <= 0.60 else "Elevated"

    try:
        weights = get_training_weights()
        bounds = get_training_bounds()
        latest_df = pd.DataFrame([{k: latest[k] for k in RAW_COLS}])
        latest_norm = normalize_with_fixed_bounds(latest_df, bounds).iloc[0].fillna(0.0).to_dict()
        pct = _pct_metrics(latest_norm)
        drivers = _build_drivers(latest_norm, weights)
    except Exception:
        logger.exception("Scoring breakdown failed for %s", user_id)
        pct = {"rest_pct": 0, "focus_pct": 0, "balance_pct": 0}
        drivers = []

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
        suggestions = [
            {"title": s, "body": ""}
            for s in get_suggestions_for_session(cli=current_cli, **signals)
        ]
    except Exception:
        logger.exception("Suggestions failed for %s", user_id)
        suggestions = []

    return {
        "ok": True,
        "user": profile,
        "cli": current_cli,
        "cli_category": current_category,
        "stress_level": stress_str,
        "energy_level": f"{energy_val}%",
        **pct,
        "late_night_count": sum(r["late_night"] for r in rows),
        "session_count": len(rows),
        "avg_duration": round(sum(r["work_duration"] for r in rows) / len(rows), 1),
        "latest": _to_session_row(latest, local_tz),
        "trend": _build_trend(rows),
        "forecast": forecast,
        "suggestions": suggestions,
        "drivers": drivers,
        "compare": _build_compare(latest, baseline) if baseline else [],
    }
