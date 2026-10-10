from datetime import datetime
from typing import Literal, Optional
from pydantic import BaseModel, EmailStr, Field

# Defined up top, before any class below uses it as a type hint.
ActivityType = Literal["work", "hobby", "entertainment", "break", "other"]


class SessionIn(BaseModel):
    typing_mean: float
    typing_variance: float
    task_switching: float
    work_duration: float
    late_night: int = Field(..., ge=0, le=1)
    timestamp_utc: Optional[datetime] = None


class SessionOut(BaseModel):
    id: str
    user_id: str
    typing_mean: float
    typing_variance: float
    task_switching: float
    work_duration: float
    late_night: int
    cli_score: float
    risk_level: str
    timestamp_utc: datetime
    baseline_deviation: dict = {}
    cli_score_raw: Optional[float] = None
    context_multiplier: float = 1.0


class PredictRequest(BaseModel):
    session_id: Optional[str] = None
    typing_mean: Optional[float] = None
    typing_variance: Optional[float] = None
    task_switching: Optional[float] = None
    work_duration: Optional[float] = None
    late_night: Optional[int] = None
    activity_type: Optional[ActivityType] = None
    engagement_score: Optional[int] = Field(None, ge=1, le=5)


class PredictResponse(BaseModel):
    cli_score: float
    risk_level: str
    risk_probability: float
    shap_explanation: dict
    baseline_deviation: dict = {}
    context_multiplier: float = 1.0
    risk_probability_adjusted: Optional[float] = None
    risk_level_adjusted: Optional[str] = None


class BaselineResponse(BaseModel):
    user_id: str
    typing_mean_avg: float = 0
    typing_variance_avg: float = 0
    task_switching_avg: float = 0
    work_duration_avg: float = 0
    late_night_avg: float = 0
    session_count: int = 0
    is_established: bool = False


class BaselineDeviationResponse(BaseModel):
    user_id: str
    is_established: bool
    typing_mean_vs_usual: float = 0
    typing_variance_vs_usual: float = 0
    task_switching_vs_usual: float = 0
    work_duration_vs_usual: float = 0
    late_night_vs_usual_pct_points: float = 0


class InterventionCreate(BaseModel):
    session_id: Optional[str] = None
    intervention_type: str
    risk_before: Optional[float] = None
    cli_before: Optional[float] = None
    task_switching_before: Optional[float] = None
    work_duration_before: Optional[float] = None


class InterventionResponseUpdate(BaseModel):
    status: str


class InterventionCompletionUpdate(BaseModel):
    completed: bool


class InterventionOutcomeUpdate(BaseModel):
    risk_after: Optional[float] = None
    cli_after: Optional[float] = None
    task_switching_after: Optional[float] = None
    work_duration_after: Optional[float] = None


class InterventionFeedbackUpdate(BaseModel):
    user_feedback: str


class InterventionOut(BaseModel):
    id: str
    user_id: str
    session_id: Optional[str] = None
    intervention_type: str
    status: str
    completed: Optional[bool] = None
    risk_before: Optional[float] = None
    cli_before: Optional[float] = None
    task_switching_before: Optional[float] = None
    work_duration_before: Optional[float] = None
    risk_after: Optional[float] = None
    cli_after: Optional[float] = None
    task_switching_after: Optional[float] = None
    work_duration_after: Optional[float] = None
    user_feedback: Optional[str] = None
    created_at: datetime
    resolved_at: Optional[datetime] = None


class SuggestionsResponse(BaseModel):
    risk_level: str
    suggestions: list[str]
    interventions: list[InterventionOut] = []


class ActivityCheckIn(BaseModel):
    session_id: Optional[str] = None
    activity_type: ActivityType
    engagement_score: Optional[int] = Field(None, ge=1, le=5)
    duration_min: Optional[float] = Field(30, gt=0, le=480)
    segment_start_utc: Optional[datetime] = None
    note: Optional[str] = None


class ActivityCheckInOut(BaseModel):
    id: str
    user_id: str
    session_id: Optional[str] = None
    activity_type: str
    engagement_score: Optional[int] = None
    context_multiplier: float
    segment_start_utc: datetime
    segment_end_utc: datetime
    note: Optional[str] = None
    created_at: Optional[datetime] = None


class ActivitySummaryResponse(BaseModel):
    user_id: str
    days: int
    total_minutes_logged: float
    pct_by_activity_type: dict[str, float] = {}
    avg_engagement_score: Optional[float] = None
    checkin_count: int