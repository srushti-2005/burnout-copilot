import logging

from fastapi import APIRouter, Depends, HTTPException

from core.security import get_current_user_id
from services.digital_twin import load_digital_twin

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/twin", tags=["digital-twin"])


@router.get("")
def get_digital_twin(user_id: str = Depends(get_current_user_id)):
    """Identity comes only from the verified token. No user id in the URL."""
    try:
        return load_digital_twin(user_id)
    except Exception:
        logger.exception("Digital twin build failed for user %s", user_id)
        raise HTTPException(status_code=502, detail="Could not build digital twin, please try again")