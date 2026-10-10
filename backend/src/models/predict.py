# src/models/predict.py

import joblib
import pandas as pd

from src.config.config import MODEL_PATH, FEATURE_COLUMNS
from src.features.activity_context import compute_context_multiplier

PREDICTION_THRESHOLD = 0.5


# -----------------------------
# Load trained model
# -----------------------------
def load_model():
    return joblib.load(MODEL_PATH)


# -----------------------------
# Predict Burnout (raw, unchanged)
# -----------------------------
def predict_burnout(input_dict: dict):
    """Raw model prediction from behavioral features only -- untouched.
    evaluate_model.py and any batch/offline scoring should keep calling
    this one directly, so accuracy/precision metrics stay comparable to
    the model as it was actually trained and validated.
    """

    model = load_model()

    # Convert input to DataFrame
    input_df = pd.DataFrame([input_dict])

    # Ensure correct feature order
    input_df = input_df[FEATURE_COLUMNS]

    # Prediction
    prediction = model.predict(input_df)[0]

    # Probability (useful for dashboard)
    probability = model.predict_proba(input_df)[0][1]

    return {
        "prediction": int(prediction),
        "burnout_probability": float(probability)
    }


# -----------------------------
# Predict Burnout, adjusted for self-reported activity context
# -----------------------------
def predict_burnout_with_context(
    input_dict: dict,
    activity_type: str | None = None,
    engagement_score: int | None = None,
):
    """Same model, same raw features -- the model itself never sees
    activity_type/engagement_score. This scales the *output* probability
    by the same context_multiplier used for cli_score_adjusted in
    feature_engineering.py, so a session tagged as an engaging hobby
    doesn't inherit the full burnout risk that raw screen-time alone
    would imply.

    activity_type=None (no check-in yet for this segment) is the normal
    case for most calls -- it's a pure passthrough with multiplier 1.0,
    so this is safe to call everywhere predict_burnout() is called today.
    """

    raw = predict_burnout(input_dict)

    if activity_type is None:
        return {
            **raw,
            "context_multiplier": 1.0,
            "burnout_probability_adjusted": raw["burnout_probability"],
            "prediction_adjusted": raw["prediction"],
        }

    multiplier = compute_context_multiplier(activity_type, engagement_score)
    adjusted_probability = min(1.0, max(0.0, raw["burnout_probability"] * multiplier))
    adjusted_prediction = int(adjusted_probability >= PREDICTION_THRESHOLD)

    return {
        **raw,
        "context_multiplier": multiplier,
        "burnout_probability_adjusted": float(adjusted_probability),
        "prediction_adjusted": adjusted_prediction,
    }