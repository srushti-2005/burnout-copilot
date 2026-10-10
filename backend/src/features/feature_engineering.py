# src/features/feature_engineering.py

import pandas as pd

from src.config.config import (
    PROCESSED_DATA_PATH,
    USER_COLUMN,
    TIMESTAMP_COLUMN
)
from src.features.activity_context import apply_context_to_dataframe


# -----------------------------
# Load Processed Dataset
# -----------------------------
def load_processed_data():
    df = pd.read_csv(PROCESSED_DATA_PATH)

    # Ensure timestamp is datetime
    df[TIMESTAMP_COLUMN] = pd.to_datetime(df[TIMESTAMP_COLUMN])

    # Sort sessions per user
    df = df.sort_values([USER_COLUMN, TIMESTAMP_COLUMN])

    return df


# -----------------------------
# Session Index Feature
# -----------------------------
def create_session_index(df):
    df["session_index"] = df.groupby(USER_COLUMN).cumcount()
    return df


# -----------------------------
# Hour of Day Feature
# -----------------------------
def create_hour_feature(df):
    df["hour_of_day"] = df[TIMESTAMP_COLUMN].dt.hour
    return df


# -----------------------------
# Rolling CLI Mean
# -----------------------------
def create_rolling_cli(df):

    if "cli_score" not in df.columns:
        df["cli_score"] = (
            df["typing_variance"] +
            df["task_switching"] +
            df["late_night"]
        )

    df["rolling_cli"] = (
        df.groupby("user_id")["cli_score"]
        .rolling(5)
        .mean()
        .reset_index(level=0, drop=True)
    )

    return df


# -----------------------------
# Activity-Context-Adjusted CLI
# -----------------------------
def create_context_adjusted_cli(df):
    """Scale each session's cli_score by how draining vs. engaging the
    user said that time was (see src/features/activity_context.py).

    NOTE: this assumes df already has `activity_type` and
    `engagement_score` columns. Those live in the new `activity_logs`
    Supabase table, not in the raw sessions table, so preprocess.py (or
    supabase_manager.py, wherever sessions are pulled from Supabase)
    needs to left-join each session onto its matching activity_logs row
    -- by session_id if the check-in was tied to a session, otherwise by
    nearest segment_start_utc/segment_end_utc overlap -- before this
    function runs. Sessions with no matching check-in simply get a 1.0
    multiplier (see apply_context_to_dataframe), so this is safe to add
    without a full backfill.
    """
    df = apply_context_to_dataframe(df)

    # Recompute the rolling average using the adjusted score too, so the
    # dashboard trend line can show both the raw and context-aware view.
    df["rolling_cli_adjusted"] = (
        df.groupby("user_id")["cli_score_adjusted"]
        .rolling(5)
        .mean()
        .reset_index(level=0, drop=True)
    )

    return df


# -----------------------------
# Feature Engineering Pipeline
# -----------------------------
def run_feature_engineering():

    df = load_processed_data()

    df = create_session_index(df)

    df = create_hour_feature(df)

    df = create_rolling_cli(df)

    df = create_context_adjusted_cli(df)

    # Save updated dataset
    df.to_csv(PROCESSED_DATA_PATH, index=False)

    print("✅ Feature engineering complete")

    return df