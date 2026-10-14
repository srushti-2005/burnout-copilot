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
import pandas as pd

# Ensure backend root is on sys.path for IDEs and standalone executions
_BACKEND_DIR = Path(__file__).resolve().parent.parent.parent
if str(_BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(_BACKEND_DIR))

try:
    from src.auth.supabase_client import get_service_client
    from src.cli_logic import (
        get_training_weights, get_training_bounds,
        normalize_with_fixed_bounds, calculate_cli, categorize_cli,
    )
    from src.features.activity_context import compute_context_multiplier
    from src.config.config import MIN_BASELINE_SESSIONS
except ImportError:
    from backend.src.auth.supabase_client import get_service_client  # type: ignore
    from backend.src.cli_logic import (  # type: ignore
        get_training_weights, get_training_bounds,
        normalize_with_fixed_bounds, calculate_cli, categorize_cli,
    )
    from backend.src.features.activity_context import compute_context_multiplier  # type: ignore
    from backend.src.config.config import MIN_BASELINE_SESSIONS  # type: ignore

log = logging.getLogger("burnout_tracker")

MIN_SESSIONS_FOR_BASELINE = MIN_BASELINE_SESSIONS  # single source of truth: config.py

# How recent a check-in has to be to count as active context for a session.
ACTIVITY_CONTEXT_WINDOW_MINUTES = 240


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
            ended = datetime.fromisoformat(ts.replace("Z", "+00:00"))
            age_minutes = (datetime.now(timezone.utc) - ended).total_seconds() / 60
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
                ended = datetime.fromisoformat(end_str.replace("Z", "+00:00"))
                if (datetime.now(timezone.utc) - ended).total_seconds() <= 1800:
                    return recent_res.data[0]
        return None
    except Exception as e:
        log.error(f"[supabase_manager] focus session lookup failed (non-fatal): {e}")
        return None


def _get_latest_user_session(uid: str) -> dict | None:
    """Query the most recent previous session for this user."""
    try:
        sb = get_service_client()
        res = (
            sb.table("sessions").select("*")
            .eq("user_id", uid).order("created_at", desc=True)
            .limit(1).execute()
        )
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
) -> tuple:
    """
    Computes CLI with cumulative fatigue-recovery dynamics:
    1. Instantaneous Load (L_raw): CRITIC-weighted five-indicator cognitive strain.
    2. Context-Adjusted Load (L_adjusted): L_raw * context_multiplier.
    3. Baseline / Previous Session State:
       - Morning / Overnight reset: If previous session was on an earlier day
         and >= 5 hours overnight gap (or >= 6 hours break), start fresh in the morning at 0.0.
       - Intra-day Break / Logout: CLI decays smoothly with rest time (e.g. e^(-0.35 * delta_hours)),
         so logging out never wipes fatigue to zero.
    4. Asymmetric Dynamics:
       - Increase is gradual (alpha_up = 0.35)
       - Decrease is slower than increase (alpha_down = 0.12, or 0.22 if activity is 'break').
         Prevents sudden drops from e.g. 25% to 1% after heavy sessions.

    Returns (cli_raw, cli_adjusted, risk_level).
    """
    single = pd.DataFrame([{
        "typing_mean":     row["typing_mean"],
        "typing_variance": row["typing_variance"],
        "task_switching":  row["task_switching"],
        "work_duration":   row["work_duration"],
        "late_night":      int(bool(row["late_night"])),
    }])
    norm = normalize_with_fixed_bounds(single, get_training_bounds())
    instant_raw = calculate_cli(norm.iloc[0], get_training_weights())

    # 1. Passive reading / study floor:
    # A user working at their device maintains a realistic baseline load (~0.08 - 0.12)
    # even with low keystrokes or app switches. Any real activity adds directly to this baseline.
    has_activity = (
        float(row.get("work_duration", 0) or 0) > 0 or
        float(row.get("typing_mean", 0) or 0) > 0 or
        float(row.get("task_switching", 0) or 0) > 0 or
        bool(row.get("late_night", 0))
    )
    if has_activity and instant_raw < 0.08:
        instant_raw = round(0.08 + instant_raw, 4)
    elif has_activity:
        instant_raw = max(0.08, instant_raw)

    instant_adjusted = round(min(1.0, max(0.08 if has_activity else 0.0, instant_raw * context_multiplier)), 4)

    # Determine previous fatigue baseline
    now = datetime.now(timezone.utc)
    base_raw = 0.08 if has_activity else 0.0
    base_adjusted = 0.08 if has_activity else 0.0
    delta_hours = 0.0

    if prev_session:
        prev_ts_str = prev_session.get("created_at")
        if prev_ts_str:
            try:
                prev_dt = datetime.fromisoformat(prev_ts_str.replace("Z", "+00:00"))
                delta_hours = max(0.0, (now - prev_dt).total_seconds() / 3600.0)
                is_earlier_day = (prev_dt.date() < now.date())

                # Morning reset: only after overnight sleep (>= 6 hours gap on an earlier calendar day)
                if is_earlier_day and delta_hours >= 6.0:
                    base_raw = 0.08 if has_activity else 0.0
                    base_adjusted = 0.08 if has_activity else 0.0
                else:
                    # Intra-day continuity: gentle, realistic exponential rest decay for break time
                    # e^(-0.04 * delta_hours). Over 10-15 minutes of rest, retains ~99% of fatigue.
                    # Never collapses below 0.08 while user is active on the same day.
                    decay = math.exp(-0.04 * delta_hours)
                    prev_cli = float(prev_session.get("cli_score") or (0.08 if has_activity else 0.0))
                    prev_raw = float(prev_session.get("cli_score_raw") or prev_cli)
                    base_raw = max(0.08 if has_activity else 0.0, prev_raw * decay)
                    base_adjusted = max(0.08 if has_activity else 0.0, prev_cli * decay)
            except Exception:
                base_raw = 0.08 if has_activity else 0.0
                base_adjusted = 0.08 if has_activity else 0.0

    # 2. Asymmetric Fatigue/Recovery Update with Strict Gradual Step Limiting:
    # Requirement: The score should increase or decrease gradually (by 1% to 2% at a time),
    # never experiencing steep, sudden drops (like going from 29 straight to 0).
    if prev_session and base_adjusted > 0.0:
        # Scale maximum allowed drop/gain gently (1.0% to 1.5% maximum change per step)
        max_decrease = min(0.020, max(0.010, 0.015 * min(1.5, max(1.0, delta_hours * 6.0))))
        max_increase = min(0.030, max(0.015, 0.020 * min(1.5, max(1.0, delta_hours * 6.0))))

        is_break = (activity_type or "").lower() == "break"
        alpha_down = 0.10 if is_break else 0.05
        alpha_up = 0.20

        if instant_adjusted >= base_adjusted:
            target_adj = base_adjusted + alpha_up * (instant_adjusted - base_adjusted)
        else:
            target_adj = base_adjusted - alpha_down * (base_adjusted - instant_adjusted)

        if instant_raw >= base_raw:
            target_raw = base_raw + alpha_up * (instant_raw - base_raw)
        else:
            target_raw = base_raw - alpha_down * (base_raw - instant_raw)

        # Enforce gradual step limit (1-2% at a time)
        cli_adjusted = max(base_adjusted - max_decrease, min(base_adjusted + max_increase, target_adj))
        cli_raw = max(base_raw - max_decrease, min(base_raw + max_increase, target_raw))
    else:
        # Cold start (first session of day)
        cli_adjusted = max(0.08, instant_adjusted) if has_activity else max(0.0, instant_adjusted)
        cli_raw = max(0.08, instant_raw) if has_activity else max(0.0, instant_raw)

    cli_adjusted = round(min(1.0, max(0.08 if has_activity else 0.0, cli_adjusted)), 3)
    cli_raw = round(min(1.0, max(0.08 if has_activity else 0.0, cli_raw)), 3)

    risk = categorize_cli(cli_adjusted, age=age)
    return cli_raw, cli_adjusted, risk


def save_session(uid: str, data: dict):
    has_activity = (
        float(data.get("work_duration", 0) or 0) > 0 or
        float(data.get("typing_mean", 0) or 0) > 0 or
        float(data.get("task_switching", 0) or 0) > 0 or
        bool(data.get("late_night", 0))
    )
    initial_cli = 0.08 if has_activity else 0.0
    row = {
        "user_id":            uid,
        "typing_mean":        float(data.get("typing_mean", 0)),
        "typing_variance":    float(data.get("typing_variance", 0)),
        "task_switching":     int(data.get("task_switching", 0)),
        "work_duration":      float(data.get("work_duration", 0)),
        "late_night":         bool(data.get("late_night", 0)),
        "cli_score":          initial_cli,
        "cli_score_raw":      initial_cli,
        "context_multiplier": 1.0,
        "risk_level":         "Low",
        "device_source":      str(data.get("device_source") or "web"),
    }

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

    # 3. Previous Session (for cumulative fatigue / decay)
    prev_session = _get_latest_user_session(uid)

    try:
        cli_raw, cli_adjusted, risk = _compute_cli_for_row(
            row,
            age=age,
            context_multiplier=multiplier,
            prev_session=prev_session,
            activity_type=activity_type,
            is_focus_active=is_focus_active,
        )
        row["cli_score"]          = cli_adjusted
        row["cli_score_raw"]      = cli_raw
        row["context_multiplier"] = multiplier
        row["risk_level"]         = risk
    except Exception as e:
        log.error(f"[supabase_manager] CLI computation failed at write time (non-fatal): {e}")

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
            ts_utc = datetime.fromisoformat(created.replace("Z", "+00:00"))
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