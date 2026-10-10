# api/routers/interventions.py
import logging
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
import pandas as pd

from core.security import get_current_user_id

BASE_DIR = Path(__file__).resolve().parent.parent.parent
if str(BASE_DIR) not in sys.path:
    sys.path.insert(0, str(BASE_DIR))

from services.digital_twin import load_digital_twin
from services.intervention_engine import build_intervention
from src.cli_logic import get_training_weights, get_training_bounds, normalize_with_fixed_bounds
from src.data.supabase_manager import (
    create_intervention,
    record_intervention_response,
    record_intervention_completion,
    record_intervention_feedback,
    get_interventions,
    get_unresolved_interventions,
)

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/interventions", tags=["interventions"])

RAW_FEATURES = ["typing_mean", "typing_variance", "task_switching", "work_duration", "late_night"]


class FeedbackRequest(BaseModel):
    note: Optional[str] = Field(None, max_length=500)


def _normalize_current_state(current_state: Optional[dict]) -> Optional[dict]:
    """
    services.digital_twin's current_state carries RAW feature values.
    Normalize them the same way calculate_cli() does, so the contributor
    ranking operates on the same scale as the CLI score itself.
    """
    if not current_state:
        return None
    raw = {k: current_state.get(k) for k in RAW_FEATURES}
    if any(v is None for v in raw.values()):
        return None
    df = pd.DataFrame([raw])
    norm = normalize_with_fixed_bounds(df, get_training_bounds()).iloc[0].to_dict()
    norm["late_night"] = raw["late_night"]
    return norm


def _find_reusable_today(user_id: str, intervention_type: str) -> Optional[dict]:
    """
    Avoids creating a fresh 'recommended' row every single time the Home
    screen or Recommendations page is opened. If today already has an
    un-actioned row of the same type, reuse it instead of creating a
    duplicate -- accept/skip is still tracked against the original row.
    """
    try:
        recent = get_interventions(user_id, limit=10)
    except Exception:
        return None
    today = datetime.now(timezone.utc).date()
    for row in recent:
        created = row.get("created_at")
        if not created:
            continue
        try:
            created_date = datetime.fromisoformat(str(created).replace("Z", "+00:00")).date()
        except ValueError:
            continue
        if (
            created_date == today
            and row.get("intervention_type") == intervention_type
            and row.get("status") == "recommended"
        ):
            return row
    return None


@router.get("/current")
def current_intervention(user_id: str = Depends(get_current_user_id)):
    """
    Steps 1-6: build today's single top intervention from the user's own
    Digital Twin, and register it as a trackable row so it can be
    accepted/skipped/completed.

    HARDENED: the entire body is one try/except. Any unexpected failure
    anywhere in this pipeline (a missing training-data file, a transient
    Supabase error, an edge case in the contributor math) logs
    server-side and returns {"intervention": None} with a normal 200,
    instead of surfacing as a 500 that the UI can only show as a red
    error.
    """
    try:
        twin = load_digital_twin(user_id)
        current_state = twin.get("current_state")
        if not current_state:
            return {"intervention": None}

        norm = _normalize_current_state(current_state)
        weights = get_training_weights()
        deviations = twin.get("deviations", {})

        result = build_intervention(
            current_norm=norm,
            weights=weights,
            deviations=deviations,
            cli=current_state.get("cli"),
            risk_level=current_state.get("risk_level") or "",
        )
        if result is None:
            return {"intervention": None}

        existing = _find_reusable_today(user_id, result["intervention_type"])
        if existing:
            result["id"] = existing.get("id")
            result["status"] = existing.get("status", "recommended")
        else:
            try:
                row = create_intervention(
                    uid=user_id,
                    intervention_type=result["intervention_type"],
                    session_id=None,
                    before_state={
                        "cli_before": result["cli"],
                        "risk_before": round(result["cli"] * 100, 1) if result["cli"] is not None else None,
                        "task_switching_before": current_state.get("task_switching"),
                        "work_duration_before": current_state.get("work_duration"),
                    },
                )
                result["id"] = row.get("id")
                result["status"] = row.get("status", "recommended")
            except Exception:
                logger.exception(
                    "Could not create tracked intervention for user %s (non-fatal)", user_id
                )
                result["id"] = None
                result["status"] = "recommended"

        return {"intervention": result}

    except Exception:
        logger.exception("Intervention engine failed for user %s (degrading gracefully)", user_id)
        return {"intervention": None}


@router.get("/history")
def history(limit: int = 50, user_id: str = Depends(get_current_user_id)):
    return {"interventions": get_interventions(user_id, limit=limit)}


@router.get("/unresolved")
def unresolved(user_id: str = Depends(get_current_user_id)):
    return {"interventions": get_unresolved_interventions(user_id)}


@router.post("/{intervention_id}/accept")
def accept(intervention_id: str, user_id: str = Depends(get_current_user_id)):
    row = record_intervention_response(intervention_id, user_id, status="accepted")
    if row is None:
        raise HTTPException(status_code=404, detail="Intervention not found")
    return row


@router.post("/{intervention_id}/skip")
def skip(intervention_id: str, user_id: str = Depends(get_current_user_id)):
    row = record_intervention_response(intervention_id, user_id, status="skipped")
    if row is None:
        raise HTTPException(status_code=404, detail="Intervention not found")
    return row


@router.post("/{intervention_id}/complete")
def complete(intervention_id: str, user_id: str = Depends(get_current_user_id)):
    row = record_intervention_completion(intervention_id, user_id, completed=True)
    if row is None:
        raise HTTPException(status_code=404, detail="Intervention not found")
    return row


@router.post("/{intervention_id}/feedback")
def feedback(intervention_id: str, body: FeedbackRequest, user_id: str = Depends(get_current_user_id)):
    row = record_intervention_feedback(intervention_id, user_id, feedback=body.note or "")
    if row is None:
        raise HTTPException(status_code=404, detail="Intervention not found")
    return row