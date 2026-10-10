# src/data/supabase_manager.py
"""
Reads/writes behavioural session data using Supabase (Postgres).
"""

import os
from datetime import datetime, timezone
import logging
import socket
import time
import pandas as pd
from src.auth.supabase_client import get_service_client
from src.cli_logic import (
    get_training_weights, get_training_bounds,
    normalize_with_fixed_bounds, calculate_cli, categorize_cli,
)
from src.features.activity_context import compute_context_multiplier
from src.config.config import MIN_BASELINE_SESSIONS

log = logging.getLogger("burnout_tracker")

MIN_SESSIONS_FOR_BASELINE = MIN_BASELINE_SESSIONS  # single source of truth: config.py

# How recent a check-in has to be, relative to when a session is saved,
# to count as "this is what the user was doing during this session".
# Sessions are recorded automatically by the tracker/widget, independently
# of when the user taps the check-in popup, so this is a best-effort
# match by recency rather than a strict foreign key join.
ACTIVITY_CONTEXT_WINDOW_MINUTES = 60


def _get_recent_activity_context(uid: str, window_minutes: int = ACTIVITY_CONTEXT_WINDOW_MINUTES) -> dict | None:
    """Most recent activity_logs row for this user, if it ended within
    the last `window_minutes`. Returns None (never raises) so a lookup
    failure never blocks a session from saving -- it just falls back to
    an unadjusted (multiplier 1.0) CLI, same as before this feature.
    """
    try:
        sb = get_service_client()
        res = (
            sb.table("activity_logs").select("*")
            .eq("user_id", uid).order("segment_end_utc", desc=True)
            .limit(1).execute()
        )
        if not res.data:
            return None
        row = res.data[0]
        ended = datetime.fromisoformat(row["segment_end_utc"].replace("Z", "+00:00"))
        age_minutes = (datetime.now(timezone.utc) - ended).total_seconds() / 60
        if age_minutes > window_minutes:
            return None
        return row
    except Exception as e:
        log.error(f"[supabase_manager] activity context lookup failed (non-fatal): {e}")
        return None


def _compute_cli_for_row(row: dict, age: int | None = None, context_multiplier: float = 1.0) -> tuple:
    """
    Two distinct CLI values are produced here -- do not conflate them:

    cli_raw      = the CRITIC-weighted five-indicator Cognitive Load Index
                   (typing_mean, typing_variance, task_switching,
                   work_duration, late_night). Features are normalised with
                   the fixed training-derived bounds (get_training_bounds)
                   and weighted with the CRITIC weights computed from the
                   training dataset (get_training_weights); late_night is
                   used as the 0/1 value. Computed by calculate_cli()
                   (src/cli_logic.py), which neither sees age nor the
                   activity-context multiplier, and rounds to 3 decimals.

    cli_adjusted = cli_raw * context_multiplier. The multiplier comes from
                   the user's most recent activity check-in
                   (src/features/activity_context.py) and is applied AFTER
                   the canonical CLI calculation. It defaults to 1.0, in
                   which case cli_adjusted == cli_raw (sessions recorded
                   before the feature existed, or no recent check-in).

    The risk category is derived from cli_adjusted using the fixed
    thresholds in categorize_cli(): Low < 0.4 <= Medium < 0.7 <= High.
    Age never enters the numerical CLI. In the current src/cli_logic.py,
    categorize_cli() accepts `age` only for backward compatibility and
    IGNORES it, so the `age` argument below has no effect on the category;
    age is used elsewhere only as a prior for the personalised baseline
    (src/personalization/baseline_prior.py), not in this function.

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
    cli_raw = calculate_cli(norm.iloc[0], get_training_weights())
    cli_adjusted = cli_raw * context_multiplier
    risk = categorize_cli(cli_adjusted, age=age)
    return cli_raw, cli_adjusted, risk


def save_session(uid: str, data: dict):
    row = {
        "user_id":         uid,
        "typing_mean":     float(data.get("typing_mean", 0)),
        "typing_variance": float(data.get("typing_variance", 0)),
        "task_switching":  int(data.get("task_switching", 0)),
        "work_duration":   float(data.get("work_duration", 0)),
        "late_night":      bool(data.get("late_night", 0)),
    }

    # NOTE: `age` is passed through for backward compatibility only;
    # categorize_cli() currently ignores it (see _compute_cli_for_row).
    try:
        profile = get_profile(uid)
        age = profile.get("age") if profile else None
    except Exception as e:
        log.error(f"[supabase_manager] profile lookup for age failed (non-fatal): {e}")
        age = None

    # NEW: pull the user's most recent activity check-in (if recent
    # enough) and turn it into a multiplier before scoring this session.
    activity_context = _get_recent_activity_context(uid)
    multiplier = 1.0
    if activity_context:
        multiplier = compute_context_multiplier(
            activity_context.get("activity_type"),
            activity_context.get("engagement_score"),
        )

    try:
        cli_raw, cli_adjusted, risk = _compute_cli_for_row(row, age=age, context_multiplier=multiplier)
        # Stored columns:
        #   cli_score_raw      = CRITIC-weighted five-indicator CLI (canonical)
        #   cli_score          = context-adjusted CLI used by the application
        #                        (= cli_score_raw * context_multiplier; equal to
        #                        the raw value only when multiplier == 1.0)
        #   context_multiplier = activity-context multiplier (default 1.0)
        #   risk_level         = category of cli_score (age-aware boundaries)
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