# src/data/activity_manager.py
"""
Supabase persistence for activity check-ins (the "was that work or
me-time?" popup). Mirrors the conventions used in supabase_manager.py
for sessions -- same client, same table-per-concern pattern -- so it
drops in next to it rather than introducing a new style.
"""

from collections import defaultdict
from datetime import datetime, timedelta, timezone

from src.auth.supabase_client import get_service_client
from src.features.activity_context import compute_context_multiplier
from core.config import ACTIVITY_LOGS_TABLE


def save_activity_checkin(user_id: str, payload: dict) -> dict:
    """Insert one check-in. The multiplier is computed server-side (never
    trust a client-sent multiplier) from activity_type + engagement_score.
    """
    client = get_service_client()

    engagement_score = payload.get("engagement_score")
    activity_type = payload["activity_type"]
    multiplier = compute_context_multiplier(activity_type, engagement_score)

    now = datetime.now(timezone.utc)
    duration_min = payload.get("duration_min") or 30
    segment_start = payload.get("segment_start_utc") or (now - timedelta(minutes=duration_min))
    if isinstance(segment_start, datetime):
        segment_start = segment_start.isoformat()

    row = {
        "user_id": user_id,
        "session_id": payload.get("session_id"),
        "activity_type": activity_type,
        "engagement_score": engagement_score,
        "context_multiplier": multiplier,
        "segment_start_utc": segment_start,
        "segment_end_utc": now.isoformat(),
        "note": payload.get("note"),
    }

    result = client.table(ACTIVITY_LOGS_TABLE).insert(row).execute()
    return result.data[0]


def list_activity_checkins(user_id: str, limit: int = 50) -> list[dict]:
    client = get_service_client()
    result = (
        client.table(ACTIVITY_LOGS_TABLE).select("*")
        .eq("user_id", user_id).order("segment_start_utc", desc=True)
        .limit(limit).execute()
    )
    return result.data


def get_activity_summary(user_id: str, days: int = 7) -> dict:
    """Time-distribution across activity types over the last N days --
    feeds the Digital Twin panel enrichment, e.g. '62% high-engagement
    work this week vs 30% last week'.
    """
    client = get_service_client()
    since = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()

    result = (
        client.table(ACTIVITY_LOGS_TABLE).select("*")
        .eq("user_id", user_id).gte("segment_start_utc", since)
        .execute()
    )
    rows = result.data or []

    minutes_by_type: dict = defaultdict(float)
    total_minutes = 0.0
    weighted_engagement_sum = 0.0
    weighted_engagement_minutes = 0.0

    for r in rows:
        start = datetime.fromisoformat(r["segment_start_utc"])
        end = datetime.fromisoformat(r["segment_end_utc"])
        minutes = max(0.0, (end - start).total_seconds() / 60.0)

        minutes_by_type[r["activity_type"]] += minutes
        total_minutes += minutes

        if r.get("engagement_score") is not None:
            weighted_engagement_sum += r["engagement_score"] * minutes
            weighted_engagement_minutes += minutes

    pct_by_type = {
        k: round((v / total_minutes) * 100, 1) if total_minutes else 0.0
        for k, v in minutes_by_type.items()
    }
    avg_engagement = (
        round(weighted_engagement_sum / weighted_engagement_minutes, 2)
        if weighted_engagement_minutes else None
    )

    return {
        "user_id": user_id,
        "days": days,
        "total_minutes_logged": round(total_minutes, 1),
        "pct_by_activity_type": pct_by_type,
        "avg_engagement_score": avg_engagement,
        "checkin_count": len(rows),
    }