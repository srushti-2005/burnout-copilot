#api/routers/predict.py
import logging
import sys
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException

from core.security import get_current_user_id
from schemas.schemas import PredictRequest, PredictResponse

BASE_DIR = Path(__file__).resolve().parent.parent.parent
if str(BASE_DIR) not in sys.path:
    sys.path.insert(0, str(BASE_DIR))

# Adjust this import to match wherever run_prediction ends up living in
# your real predictor.py -- see predictor_INTEGRATION_SCAFFOLD.py
from api.services.predictor import run_prediction

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/predict", tags=["predict"])


@router.post("", response_model=PredictResponse)
def predict(payload: PredictRequest, user_id: str = Depends(get_current_user_id)):
    try:
        feature_dict = payload.model_dump(
            exclude={"session_id", "activity_type", "engagement_score"},
            exclude_none=True,
        )
        response = run_prediction(
            feature_dict,
            activity_type=payload.activity_type,
            engagement_score=payload.engagement_score,
        )
    except Exception:
        logger.exception("Prediction failed for user %s", user_id)
        raise HTTPException(status_code=502, detail="Could not generate prediction, please try again")

    return PredictResponse(**response)