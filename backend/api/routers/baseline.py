#api/routers/baseline.py

import logging
import sys
from pathlib import Path
from fastapi import APIRouter, Depends, HTTPException

from core.security import get_current_user_id
from schemas.schemas import BaselineResponse, BaselineDeviationResponse

BASE_DIR = Path(__file__).resolve().parent.parent.parent
if str(BASE_DIR) not in sys.path:
    sys.path.insert(0, str(BASE_DIR))

from src.data.supabase_manager import (
    get_or_create_baseline,
    get_latest_deviation,
    MIN_SESSIONS_FOR_BASELINE,
)

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/baseline", tags=["baseline"])


@router.get("", response_model=BaselineResponse)
def get_baseline(user_id: str = Depends(get_current_user_id)):
    """
    Returns the user's personalized baseline. If the user has no
    session history yet, returns all-zero values with
    is_established=False rather than a 404 — the frontend can render
    a "still learning your patterns" state instead of an error.
    """
    try:
        base = get_or_create_baseline(user_id)
    except Exception:
        logger.exception("Failed to fetch baseline for user %s", user_id)
        raise HTTPException(status_code=502, detail="Could not load baseline, please try again")

    session_count = base.get("session_count", 0) if base else 0

    return BaselineResponse(
        user_id=user_id,
        typing_mean_avg=base.get("typing_mean_avg", 0) if base else 0,
        typing_variance_avg=base.get("typing_variance_avg", 0) if base else 0,
        task_switching_avg=base.get("task_switching_avg", 0) if base else 0,
        work_duration_avg=base.get("work_duration_avg", 0) if base else 0,
        late_night_avg=base.get("late_night_avg", 0) if base else 0,
        session_count=session_count,
        is_established=session_count >= MIN_SESSIONS_FOR_BASELINE,
    )


@router.get("/deviation", response_model=BaselineDeviationResponse)
def get_baseline_deviation(user_id: str = Depends(get_current_user_id)):
    """
    Returns how the user's most recent session compares to their own
    personal baseline — the "Is X high for THIS user?" comparison from
    Phase 4. Requires at least one recorded session; 404 if none exist.
    """
    try:
        deviation = get_latest_deviation(user_id)
    except Exception:
        logger.exception("Failed to compute baseline deviation for user %s", user_id)
        raise HTTPException(status_code=502, detail="Could not compute deviation, please try again")

    if not deviation:
        raise HTTPException(status_code=404, detail="No sessions recorded yet")

    return BaselineDeviationResponse(user_id=user_id, **deviation)