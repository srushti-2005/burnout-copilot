from __future__ import annotations

# src/data/supabase_manager.py
"""
Reads/writes behavioural session data using Supabase (Postgres).
"""

import os
import sys
import math
import logging
import socket
import time
from pathlib import Path
from datetime import datetime, timezone
from types import SimpleNamespace

from dateutil import parser as _dtparser  # installed with pandas

# Ensure backend root is on sys.path for IDEs and standalone executions
_BACKEND_DIR = Path(__file__).resolve().parent.parent.parent
if str(_BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(_BACKEND_DIR))

try:
    from src.auth.supabase_client import get_service_client
    from src.cli_logic import (
        get_training_weights, get_training_bounds,
        normalize_with_fixed_bounds, calculate_cli, categorize_cli,
        compute_session_cli, is_idle,
    )
    from src.features.activity_context import compute_context_multiplier
    from src.config.config import MIN_BASELINE_SESSIONS
except ImportError:
    from backend.src.auth.supabase_client import get_service_client  # type: ignore
    from backend.src.cli_logic import (  # type: ignore
        get_training_weights, get_training_bounds,
        normalize_with_fixed_bounds, calculate_cli, categorize_cli,
        compute_session_cli, is_idle,
    )
    from backend.src.features.activity_context import compute_context_multiplier  # type: ignore
    from backend.src.config.config import MIN_BASELINE_SESSIONS  # type: ignore

log = logging.getLogger("burnout_tracker")

MIN_SESSIONS_FOR_BASELINE = MIN_BASELINE_SESSIONS  # single source of truth: config.py

# How recent a check-in has to be to count as active context for a session.
ACTIVITY_CONTEXT_WINDOW_MINUTES = 240


# Two uploads with identical raw features this close together are the same
# window sent twice (client retry after a slow Render cold start, double
# connect, ...). The second one is not stored.
DUPLICATE_WINDOW_SECONDS = 90
MAX_BACKFILL_HOURS = 48


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def parse_ts(ts) -> datetime:
    """Timezone-aware datetime from a Supabase timestamp string or datetime.
    Handles 5-digit fractional seconds that datetime.fromisoformat rejects
    on Python < 3.11."""
    dt = ts if isinstance(ts, datetime) else _dtparser.isoparse(str(ts))
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def _event_time(ts, now: datetime) -> tuple[datetime, bool]:
    """When the window really happened. Only a timezone-aware client
    timestamp that is 2 min .. 48 h old is trusted (offline mobile sync);
    anything else (naive, future, ancient, or ~now) is treated as 'now'.
    Returns (time, overridden)."""
    try:
        if ts is None:
            return now, False
        dt = ts if isinstance(ts, datetime) else _dtparser.isoparse(str(ts))
        if dt.tzinfo is None:
            return now, False
        dt = dt.astimezone(timezone.utc)
        age = (now - dt).total_seconds()
        if age < 120 or age > MAX_BACKFILL_HOURS * 3600:
            return now, False
        return dt, True
    except Exception:
        return now, False


def _is_duplicate(prev: dict | None, row: dict, event_time: datetime) -> bool:
    if not prev:
        return False
    try:
        if abs((event_time - parse_ts(prev["created_at"])).total_seconds()) > DUPLICATE_WINDOW_SECONDS:
            return False
        same = all(
            abs(float(prev.get(k) or 0) - float(row.get(k) or 0)) < 1e-6
            for k in ("typing_mean", "typing_variance", "task_switching", "work_duration")
        )
        return (
            same
            and bool(prev.get("late_night")) == bool(row.get("late_night"))
            and str(prev.get("device_source") or "web") == str(row.get("device_source") or "web")
        )
    except Exception:
        return False


def _get_recent_activity_context(uid: str, window_minutes: int = ACTIVITY_CONTEXT_WINDOW_MINUTES) -> dict | None:
    """Most recent activity_logs row for this user, if it was recorded within
    the last `window_minutes`. Returns None (never raises) on failure.
    """
    try:
        sb = get_service_client()
        res = (
            sb.table("activity_logs").select("*")
            .eq("user_id", uid).order("created_at", desc=True)
            .limit(1).execute()
        )
        if not res.data:
            return None
        row = res.data[0]
        ts = row.get("segment_end_utc") or row.get("created_at")
        if ts:
            ended = parse_ts(ts)
            age_minutes = (_utcnow() - ended).total_seconds() / 60
            if age_minutes <= window_minutes:
                return row
        return None
    except Exception as e:
        log.error(f"[supabase_manager] activity context lookup failed (non-fatal): {e}")
        return None


def _get_active_or_recent_focus_session(uid: str) -> dict | None:
    """Checks if the user has an active focus session or one completed within the last 30 minutes."""
    try:
        sb = get_service_client()
        # 1. Check currently active focus session
        active_res = (
            sb.table("focus_sessions").select("*")
            .eq("user_id", uid).eq("status", "active")
            .order("start_time", desc=True).limit(1).execute()
        )
        if active_res.data:
            return active_res.data[0]
        # 2. Check recently completed focus session (within last 30m)
        recent_res = (
            sb.table("focus_sessions").select("*")
            .eq("user_id", uid).eq("status", "completed")
            .order("end_time", desc=True).limit(1).execute()
        )
        if recent_res.data:
            end_str = recent_res.data[0].get("end_time") or recent_res.data[0].get("created_at")
            if end_str:
                ended = parse_ts(end_str)
                if (_utcnow() - ended).total_seconds() <= 1800:
                    return recent_res.data[0]
        return None
    except Exception as e:
        log.error(f"[supabase_manager] focus session lookup failed (non-fatal): {e}")
        return None


def _get_latest_user_session(uid: str, before: datetime | None = None) -> dict | None:
    """Most recent previous session for this user (strictly before `before`
    when given, for back-dated mobile uploads)."""
    try:
        sb = get_service_client()
        q = sb.table("sessions").select("*").eq("user_id", uid)
        if before is not None:
            q = q.lt("created_at", before.isoformat())
        res = q.order("created_at", desc=True).limit(1).execute()
        return res.data[0] if res.data else None
    except Exception as e:
        log.error(f"[supabase_manager] previous session query failed (non-fatal): {e}")
        return None


def _compute_cli_for_row(
    row: dict,
    age: int | None = None,
    context_multiplier: float = 1.0,
    prev_session: dict | None = None,
    activity_type: str | None = None,
    is_focus_active: bool = False,
    now: datetime | None = None,
) -> tuple:
    """CLI for one new session. Returns (cli_raw, cli_adjusted, risk_level).

    The score formula is the original CRITIC formula (cli_logic.calculate_cli).
    What this adds is how the score MOVES between sessions:
      * no typing, no variance, no window switches -> instantaneous load is
        exactly 0 (work_duration alone is elapsed time, not load);
      * rises and falls gradually, with NO artificial floor, so an idle user
        reaches 0 after a realistic rest period;
      * time without data rests the old value toward 0 first, so overnight
        gaps reset naturally (no calendar-day / timezone logic).
    `age`, `activity_type` and `is_focus_active` are kept for caller
    compatibility; age never influences the score.
    """
    now = now or _utcnow()
    gap_min = None
    if prev_session and prev_session.get("created_at"):
        try:
            gap_min = max(0.0, (now - parse_ts(prev_session["created_at"])).total_seconds() / 60.0)
        except Exception:
            log.exception("[supabase_manager] could not parse previous session time; treating as first session")
            prev_session = None
    else:
        prev_session = None
    return compute_session_cli(
        row, prev_session, gap_min, context_multiplier,
        weights=get_training_weights(), bounds=get_training_bounds(),
    )


def save_session(uid: str, data: dict):
    now = _utcnow()
    event_time, overridden = _event_time(data.get("timestamp_utc"), now)
    row = {
        "user_id":            uid,
        "typing_mean":        float(data.get("typing_mean") or 0),
        "typing_variance":    float(data.get("typing_variance") or 0),
        "task_switching":     int(data.get("task_switching") or 0),
        "work_duration":      float(data.get("work_duration") or 0),
        "late_night":         bool(data.get("late_night", 0)),
        "cli_score":          0.0,
        "cli_score_raw":      0.0,
        "context_multiplier": 1.0,
        "risk_level":         "Low",
        "device_source":      str(data.get("device_source") or "web"),
    }
    if overridden:
        row["created_at"] = event_time.isoformat()

    # Previous session (for the CLI chain) -- also used to drop duplicates.
    prev_session = _get_latest_user_session(uid, before=event_time if overridden else None)
    if _is_duplicate(prev_session, row, event_time):
        log.info(f"[supabase_manager] duplicate upload ignored for user {uid} (id={prev_session.get('id')})")
        return SimpleNamespace(data=[prev_session])

    try:
        profile = get_profile(uid)
        age = profile.get("age") if profile else None
    except Exception as e:
        log.error(f"[supabase_manager] profile lookup for age failed (non-fatal): {e}")
        age = None

    # 1. Activity Check-in Context (work, hobby, break, entertainment, other)
    activity_context = _get_recent_activity_context(uid)
    activity_type = activity_context.get("activity_type") if activity_context else None
    activity_mult = 1.0
    if activity_context:
        activity_mult = compute_context_multiplier(
            activity_type,
            activity_context.get("engagement_score"),
        )

    # 2. Focus Mode Context
    focus_context = _get_active_or_recent_focus_session(uid)
    focus_mult = 1.0
    is_focus_active = False
    if focus_context:
        is_focus_active = (focus_context.get("status") == "active")
        distraction_count = focus_context.get("distraction_count", 0) or 0
        if distraction_count == 0:
            focus_mult = 0.75  # Deep undisturbed flow
        else:
            focus_mult = 0.85

    # Combined context multiplier
    multiplier = round(min(1.10, max(0.05, activity_mult * focus_mult)), 3)

    try:
        cli_raw, cli_adjusted, risk = _compute_cli_for_row(
            row,
            age=age,
            context_multiplier=multiplier,
            prev_session=prev_session,
            activity_type=activity_type,
            is_focus_active=is_focus_active,
            now=event_time,
        )
        row["cli_score"]          = cli_adjusted
        row["cli_score_raw"]      = cli_raw
        row["context_multiplier"] = multiplier
        row["risk_level"]         = risk
    except Exception:
        log.exception("[supabase_manager] CLI computation failed at write time (non-fatal)")

    last_error = None
    for attempt in range(1, 5):
        try:
            sb = get_service_client()
            result = sb.table("sessions").insert(row).execute()

            # ── Self-diagnosing confirmation log ────────────────────────
            # Prints the exact project this insert went to and the id
            # Supabase actually assigned it, so "I don't see it in the
            # table" can be resolved by searching for this exact id in
            # this exact project, instead of guessing about views,
            # caching, or wrong environments.
            try:
                inserted_id = result.data[0]["id"] if result.data else None
                project_url = os.environ.get("SUPABASE_URL", "UNSET")
                log.info(
                    f"[supabase_manager] session insert CONFIRMED — "
                    f"id={inserted_id} project={project_url}"
                )
            except Exception:
                pass

            if not is_idle(row):  # idle windows must not drag the personal baseline toward 0
                _update_baseline_after_session(sb, uid, row)
            _auto_resolve_interventions(sb, uid, row)
            return result
        except Exception as e:
            last_error = e
            error_text = str(e).lower()
            transient = (
                isinstance(e, socket.gaierror)
                or "getaddrinfo failed" in error_text
                or "name or service not known" in error_text
                or "temporary failure in name resolution" in error_text
                or "connection refused" in error_text
                or "connection reset" in error_text
                or "connecterror" in error_text
                or "connecttimeout" in error_text
            )
            if not transient or attempt == 4:
                raise
            delay = 2 ** (attempt - 1)
            log.warning(
                f"[supabase_manager] Temporary Supabase/network failure "
                f"(attempt {attempt}/4): {e}. Retrying in {delay}s..."
            )
            time.sleep(delay)

    # pyrefly: ignore [bad-raise]
    raise last_error


def get_user_sessions(uid: str, limit: int = 200) -> list[dict]:
    sb = get_service_client()
    res = (
        sb.table("sessions")
        .select("*")
        .eq("user_id", uid)
        .order("created_at", desc=True)
        .limit(limit)
        .execute()
    )
    rows = res.data or []
    rows.reverse()

    sessions = []
    for r in rows:
        created = r.get("created_at")
        if created:
            ts_utc = parse_ts(created)
            ts = ts_utc.astimezone()
        else:
            ts = datetime.now().astimezone()

        sessions.append({
            "uid":              r.get("user_id"),
            "typing_mean":      r.get("typing_mean", 0),
            "typing_variance":  r.get("typing_variance", 0),
            "task_switching":   r.get("task_switching", 0),
            "work_duration":    r.get("work_duration", 0),
            "late_night":       int(bool(r.get("late_night", False))),
            "hour_of_day":      ts.hour,
            "timestamp":        ts,
        })
    return sessions


def get_or_create_baseline(uid: str) -> dict:
    sb = get_service_client()
    res = sb.table("user_baselines").select("*").eq("user_id", uid).execute()
    return res.data[0] if res.data else {}


def update_baseline(uid: str, baseline: dict):
    sb = get_service_client()
    row = {"user_id": uid, **baseline}
    return sb.table("user_baselines").upsert(row).execute()


def _incremental_mean(old_avg, old_count: int, new_value: float) -> float:
    if old_avg is None or not old_count:
        return float(new_value)
    return (float(old_avg) * old_count + float(new_value)) / (old_count + 1)


def _update_baseline_after_session(sb, uid: str, row: dict):
    try:
        existing = sb.table("user_baselines").select("*").eq("user_id", uid).execute()
        base  = existing.data[0] if existing.data else {}
        count = base.get("session_count", 0) or 0

        updated = {
            "user_id":             uid,
            "typing_mean_avg":     _incremental_mean(base.get("typing_mean_avg"),     count, row["typing_mean"]),
            "typing_variance_avg": _incremental_mean(base.get("typing_variance_avg"), count, row["typing_variance"]),
            "task_switching_avg":  _incremental_mean(base.get("task_switching_avg"),  count, row["task_switching"]),
            "work_duration_avg":   _incremental_mean(base.get("work_duration_avg"),   count, row["work_duration"]),
            "late_night_avg":      _incremental_mean(base.get("late_night_avg"),      count, int(bool(row["late_night"]))),
            "session_count":       count + 1,
        }
        sb.table("user_baselines").upsert(updated).execute()
    except Exception as e:
        log.error(f"[supabase_manager] baseline update failed (non-fatal): {e}")


def _pct_diff(current, avg):
    if not avg:
        return 0.0
    return round(((current - avg) / avg) * 100, 1)


def _pct_point_diff(current, avg):
    return round((float(current) - float(avg)) * 100, 1)


def compare_to_baseline(uid: str, latest_session: dict, base_override: dict | None = None) -> dict:
    """Compare a session to the user's baseline.

    IMPORTANT: the baseline used must NOT contain `latest_session`.
    - New session: call this BEFORE save_session() (which updates the baseline).
    - Already-saved session: pass `base_override` built from prior sessions
      only (see get_latest_deviation).
    """
    base = base_override if base_override is not None else get_or_create_baseline(uid)
    if not base or not base.get("session_count"):
        return {}

    session_count = base.get("session_count", 0)

    return {
        "is_established": session_count >= MIN_SESSIONS_FOR_BASELINE,
        "typing_mean_vs_usual":     _pct_diff(latest_session.get("typing_mean", 0),     base.get("typing_mean_avg")),
        "typing_variance_vs_usual": _pct_diff(latest_session.get("typing_variance", 0), base.get("typing_variance_avg")),
        "task_switching_vs_usual":  _pct_diff(latest_session.get("task_switching", 0),  base.get("task_switching_avg")),
        "work_duration_vs_usual":   _pct_diff(latest_session.get("work_duration", 0),   base.get("work_duration_avg")),
        "late_night_vs_usual_pct_points": _pct_point_diff(latest_session.get("late_night", 0), base.get("late_night_avg", 0)),
    }


def get_latest_deviation(uid: str) -> dict:
    """Deviation of the latest saved session vs. the baseline built from the
    sessions BEFORE it (the stored baseline already includes the latest one,
    so it is rebuilt here from prior sessions only)."""
    sessions = get_user_sessions(uid, limit=200)
    if not sessions:
        return {}
    latest, prior = sessions[-1], sessions[:-1]
    if not prior:
        return {}

    def _avg(key):
        return sum(float(s[key]) for s in prior) / len(prior)

    stored_count = (get_or_create_baseline(uid).get("session_count") or 0) - 1
    prior_base = {
        "typing_mean_avg":     _avg("typing_mean"),
        "typing_variance_avg": _avg("typing_variance"),
        "task_switching_avg":  _avg("task_switching"),
        "work_duration_avg":   _avg("work_duration"),
        "late_night_avg":      _avg("late_night"),
        "session_count":       max(len(prior), stored_count),
    }
    return compare_to_baseline(uid, latest, base_override=prior_base)


# ── Profile (Feature 1) ─────────────────────────────────────────────────

def upsert_profile_age(uid: str, email: str, display_name: str, age: int):
    sb = get_service_client()
    try:
        sb.table("profiles").upsert({
            "id": uid,
            "email": email,
            "display_name": display_name,
            "age": age,
        }).execute()
    except Exception as e:
        log.error(f"[supabase_manager] profile upsert with age failed (non-fatal): {e}")


def get_profile(uid: str) -> dict:
    sb = get_service_client()
    res = sb.table("profiles").select("*").eq("id", uid).execute()
    return res.data[0] if res.data else {}


def update_profile(uid: str, fields: dict):
    sb = get_service_client()
    row = {"id": uid, **fields, "updated_at": datetime.now(timezone.utc).isoformat()}
    return sb.table("profiles").upsert(row).execute()


# ── Interventions (Feature 3) ───────────────────────────────────────────

def create_intervention(uid: str, intervention_type: str, session_id, before_state: dict) -> dict:
    sb = get_service_client()
    row = {
        "user_id": uid,
        "session_id": session_id,
        "intervention_type": intervention_type,
        "status": "recommended",
        "risk_before": before_state.get("risk_before"),
        "cli_before": before_state.get("cli_before"),
        "task_switching_before": before_state.get("task_switching_before"),
        "work_duration_before": before_state.get("work_duration_before"),
    }
    result = sb.table("interventions").insert(row).execute()
    return result.data[0]


def _get_owned_intervention(sb, intervention_id: str, uid: str):
    res = sb.table("interventions").select("*").eq("id", intervention_id).eq("user_id", uid).execute()
    return res.data[0] if res.data else None


def record_intervention_response(intervention_id: str, uid: str, status: str):
    sb = get_service_client()
    if not _get_owned_intervention(sb, intervention_id, uid):
        return None
    sb.table("interventions").update({"status": status}).eq("id", intervention_id).execute()
    return _get_owned_intervention(sb, intervention_id, uid)


def record_intervention_completion(intervention_id: str, uid: str, completed: bool):
    sb = get_service_client()
    if not _get_owned_intervention(sb, intervention_id, uid):
        return None
    sb.table("interventions").update({"completed": completed}).eq("id", intervention_id).execute()
    return _get_owned_intervention(sb, intervention_id, uid)


def record_intervention_outcome(intervention_id: str, uid: str, after_state: dict):
    sb = get_service_client()
    if not _get_owned_intervention(sb, intervention_id, uid):
        return None
    row = {**after_state, "resolved_at": datetime.now(timezone.utc).isoformat()}
    sb.table("interventions").update(row).eq("id", intervention_id).execute()
    return _get_owned_intervention(sb, intervention_id, uid)


def record_intervention_feedback(intervention_id: str, uid: str, feedback: str):
    sb = get_service_client()
    if not _get_owned_intervention(sb, intervention_id, uid):
        return None
    sb.table("interventions").update({"user_feedback": feedback}).eq("id", intervention_id).execute()
    return _get_owned_intervention(sb, intervention_id, uid)


def get_interventions(uid: str, limit: int = 50) -> list[dict]:
    sb = get_service_client()
    res = (
        sb.table("interventions").select("*")
        .eq("user_id", uid).order("created_at", desc=True)
        .limit(limit).execute()
    )
    return res.data or []


def get_unresolved_interventions(uid: str) -> list[dict]:
    sb = get_service_client()
    res = (
        sb.table("interventions").select("*")
        .eq("user_id", uid).eq("status", "accepted")
        .is_("resolved_at", "null")
        .execute()
    )
    return res.data or []


def _auto_resolve_interventions(sb, uid: str, new_session_row: dict):
    try:
        pending = get_unresolved_interventions(uid)
        for intervention in pending:
            sb.table("interventions").update({
                "cli_after": new_session_row.get("cli_score"),
                "task_switching_after": new_session_row.get("task_switching"),
                "work_duration_after": new_session_row.get("work_duration"),
                "resolved_at": datetime.now(timezone.utc).isoformat(),
            }).eq("id", intervention["id"]).execute()
    except Exception as e:
        log.error(f"[supabase_manager] auto-resolve interventions failed (non-fatal): {e}")