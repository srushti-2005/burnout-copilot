#api/routers/activity.py
import logging
import sys
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException

from core.security import get_current_user_id
from schemas.schemas import ActivityCheckIn, ActivityCheckInOut, ActivitySummaryResponse

BASE_DIR = Path(__file__).resolve().parent.parent.parent
if str(BASE_DIR) not in sys.path:
    sys.path.insert(0, str(BASE_DIR))

from src.data.activity_manager import (
    save_activity_checkin,
    list_activity_checkins,
    get_activity_summary,
)

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/activity", tags=["activity"])


@router.post("/checkin", response_model=ActivityCheckInOut)
def create_checkin(payload: ActivityCheckIn, user_id: str = Depends(get_current_user_id)):
    try:
        saved = save_activity_checkin(user_id, payload.model_dump())
    except Exception:
        logger.exception("Failed to save activity check-in for user %s", user_id)
        raise HTTPException(status_code=502, detail="Could not save check-in, please try again")

    return ActivityCheckInOut(**saved)


@router.get("", response_model=list[ActivityCheckInOut])
def list_checkins(limit: int = 50, user_id: str = Depends(get_current_user_id)):
    try:
        rows = list_activity_checkins(user_id, limit=limit)
    except Exception:
        logger.exception("Failed to fetch activity check-ins for user %s", user_id)
        raise HTTPException(status_code=502, detail="Could not load check-ins, please try again")

    return [ActivityCheckInOut(**r) for r in rows]


@router.get("/summary", response_model=ActivitySummaryResponse)
def activity_summary(days: int = 7, user_id: str = Depends(get_current_user_id)):
    """Time-distribution across activity types -- feeds the Digital Twin
    panel enrichment, e.g. '62% high-engagement work this week vs 30% last
    week'.
    """
    try:
        summary = get_activity_summary(user_id, days=days)
    except Exception:
        logger.exception("Failed to compute activity summary for user %s", user_id)
        raise HTTPException(status_code=502, detail="Could not compute activity summary")

    return ActivitySummaryResponse(**summary)