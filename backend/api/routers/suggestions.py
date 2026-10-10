#api/routers/suggestions.py
import logging
import re
import sys
from pathlib import Path
from fastapi import APIRouter, Depends

from core.security import get_current_user_id
from services.cli import compute_cli_score
from schemas.schemas import SessionIn, SuggestionsResponse, InterventionOut

BASE_DIR = Path(__file__).resolve().parent.parent.parent
if str(BASE_DIR) not in sys.path:
    sys.path.insert(0, str(BASE_DIR))

from src.suggestions.suggestion_engine import get_suggestions
from src.data.supabase_manager import create_intervention, get_profile

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/suggestions", tags=["suggestions"])


def _slugify(title: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", title.lower()).strip("_")


@router.post("", response_model=SuggestionsResponse)
def suggestions(payload: SessionIn, user_id: str = Depends(get_current_user_id)):
    signals = {
        "typing_mean": payload.typing_mean, "typing_variance": payload.typing_variance,
        "task_switching": payload.task_switching, "work_duration": payload.work_duration,
        "late_night": payload.late_night,
    }

    # Fetch the profile once, up front, so both the CLI category and the
    # greeting use it. age is passed into compute_cli_score() the same way
    # supabase_manager._compute_cli_for_row() already does for /sessions —
    # this is the fix that makes /suggestions agree with /sessions.
    profile = get_profile(user_id)
    age = profile.get("age") if profile else None
    user_name = (profile.get("display_name") if profile else None) or "there"

    cli, risk_level = compute_cli_score(signals, age=age)

    generated = get_suggestions(cli=cli, user_name=user_name, **signals)
    texts = [s.message for s in generated]

    tracked: list[InterventionOut] = []
    for s in generated:
        if s.level == "success":
            # "You're doing well" isn't an actionable intervention —
            # nothing for the user to accept/skip, so it isn't tracked.
            continue
        try:
            row = create_intervention(
                uid=user_id,
                intervention_type=_slugify(s.title),
                session_id=None,
                before_state={
                    "cli_before": cli,
                    "risk_before": None,
                    "task_switching_before": payload.task_switching,
                    "work_duration_before": payload.work_duration,
                },
            )
            tracked.append(InterventionOut(**row))
        except Exception:
            logger.exception(
                "Failed to create tracked intervention for user %s (non-fatal)", user_id
            )

    return SuggestionsResponse(risk_level=risk_level, suggestions=texts, interventions=tracked)