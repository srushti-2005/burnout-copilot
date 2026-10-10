import logging
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from core.config import CORS_ORIGINS
from routers import sessions, baseline, suggestions, dashboard, auth, twin, focus, interventions, activity

# NOTE: "predict" still not imported. api/routers/predict.py's own
# content is an accidental duplicate of sessions.py, and there is no
# working api/services/predictor.py to wire it to yet. See
# INTEGRATION_NOTES.md for the files needed to sort that path out --
# it's a separate question from the activity-context feature below,
# which only needed the "activity" router.
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)],
)
logger = logging.getLogger(__name__)
app = FastAPI(title="Burnout Copilot API", version="1.1.0")
app.add_middleware(CORSMiddleware, allow_origins=CORS_ORIGINS, allow_methods=["*"], allow_headers=["*"])
app.include_router(dashboard.router)
app.include_router(auth.router)
app.include_router(sessions.router)
app.include_router(baseline.router)
app.include_router(suggestions.router)
app.include_router(twin.router)
app.include_router(focus.router)
app.include_router(interventions.router)
app.include_router(activity.router)  # NEW

@app.get("/health")
def health():
    return {"status": "ok"}
@app.get("/")
def root():
    return {"status": "ok", "message": "Burnout Copilot API is running"}