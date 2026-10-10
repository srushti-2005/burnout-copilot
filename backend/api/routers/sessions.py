#api/routers/sessions.py
import logging
import sys
from pathlib import Path
from fastapi import APIRouter, Depends, HTTPException

from core.security import get_current_user_id
from schemas.schemas import SessionIn, SessionOut

BASE_DIR = Path(__file__).resolve().parent.parent.parent
if str(BASE_DIR) not in sys.path:
    sys.path.insert(0, str(BASE_DIR))

from src.data.supabase_manager import save_session, compare_to_baseline
from src.auth.supabase_client import get_service_client
from core.config import SESSIONS_TABLE

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/sessions", tags=["sessions"])


@router.post("", response_model=SessionOut)
def create_session(payload: SessionIn, user_id: str = Depends(get_current_user_id)):
    data = payload.model_dump()

    # Phase 4 -- compare to the user's baseline BEFORE saving. save_session()
    # folds the new session into the baseline, so comparing afterwards would
    # let the session influence the baseline it is judged against.
    # Non-fatal: a deviation failure must never block the session from saving.
    deviation = {}
    try:
        deviation = compare_to_baseline(user_id, {
            "typing_mean":     float(data.get("typing_mean", 0)),
            "typing_variance": float(data.get("typing_variance", 0)),
            "task_switching":  int(data.get("task_switching", 0)),
            "work_duration":   float(data.get("work_duration", 0)),
            "late_night":      int(bool(data.get("late_night", 0))),
        })
    except Exception:
        logger.exception("Failed to compute baseline deviation for user %s", user_id)

    try:
        result = save_session(user_id, data)
    except Exception:
        logger.exception("Failed to save session for user %s", user_id)
        raise HTTPException(status_code=502, detail="Could not save session, please try again")

    saved = result.data[0]

    return SessionOut(
        id=saved["id"], user_id=saved["user_id"],
        typing_mean=saved["typing_mean"], typing_variance=saved["typing_variance"],
        task_switching=saved["task_switching"], work_duration=saved["work_duration"],
        late_night=int(saved["late_night"]),
        cli_score=saved["cli_score"], risk_level=saved["risk_level"],
        timestamp_utc=saved["created_at"],
        baseline_deviation=deviation,
        # NEW — both default sensibly if an older row/pre-migration schema lacks them:
        cli_score_raw=saved.get("cli_score_raw"),
        context_multiplier=saved.get("context_multiplier", 1.0),
    )


@router.get("", response_model=list[SessionOut])
def list_sessions(limit: int = 50, user_id: str = Depends(get_current_user_id)):
    try:
        client = get_service_client()
        result = (
            client.table(SESSIONS_TABLE).select("*")
            .eq("user_id", user_id).order("created_at", desc=True)
            .limit(limit).execute()
        )
    except Exception:
        logger.exception("Failed to fetch sessions for user %s", user_id)
        raise HTTPException(status_code=502, detail="Could not load sessions, please try again")

    return [
        SessionOut(
            id=r["id"], user_id=r["user_id"],
            typing_mean=r["typing_mean"], typing_variance=r["typing_variance"],
            task_switching=r["task_switching"], work_duration=r["work_duration"],
            late_night=int(r["late_night"]),
            cli_score=r["cli_score"], risk_level=r["risk_level"],
            timestamp_utc=r["created_at"],
            # NEW:
            cli_score_raw=r.get("cli_score_raw"),
            context_multiplier=r.get("context_multiplier", 1.0),
        )
        for r in result.data
    ]