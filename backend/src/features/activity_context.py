# src/features/activity_context.py
"""
Context-aware CLI adjustment.

Not all screen-time carries the same cognitive cost. A behavioral segment
tagged as low-engagement "work" should count close to its full raw CLI
contribution, while a segment the user marks as an engaging hobby should
count for much less -- and a break should count for almost nothing.

This module turns an (activity_type, engagement_score) pair into a single
multiplier that scales cli_score before it reaches the burnout model.
Keep this logic here (not inline in the router or the pipeline) so both
the live API path and the offline feature-engineering path use the exact
same weighting.
"""

from __future__ import annotations

ACTIVITY_TYPES = ("work", "hobby", "entertainment", "break", "other")

# Base multiplier per activity type, before the engagement adjustment.
# Tune these against real user data once you have enough sessions --
# these are reasonable starting points, not calibrated constants.
_BASE_MULTIPLIER = {
    "work": 1.00,
    "entertainment": 0.70,   # passive scrolling still costs something
    "hobby": 0.45,
    "other": 0.60,
    "break": 0.05,
}

# How much a high engagement_score pulls the multiplier down (flow-state
# work is less draining than distracted work; an engaging hobby is less
# draining than a bored one), and how much a low score pushes it up.
_ENGAGEMENT_ADJUSTMENT = {
    1: 0.15,
    2: 0.075,
    3: 0.0,
    4: -0.075,
    5: -0.15,
}

_MIN_MULTIPLIER = 0.05
_MAX_MULTIPLIER = 1.10


def compute_context_multiplier(activity_type: str, engagement_score: int | None = None) -> float:
    """Return the multiplier to apply to a segment's raw CLI contribution.

    engagement_score is optional -- a check-in with only activity_type
    (e.g. the user tapped "Break" and nothing else) still gets a sensible
    default multiplier.
    """
    activity_type = (activity_type or "other").lower()
    base = _BASE_MULTIPLIER.get(activity_type, _BASE_MULTIPLIER["other"])

    if engagement_score is None:
        adjustment = 0.0
    else:
        engagement_score = max(1, min(5, int(engagement_score)))
        adjustment = _ENGAGEMENT_ADJUSTMENT[engagement_score]

    multiplier = base + adjustment
    return round(min(_MAX_MULTIPLIER, max(_MIN_MULTIPLIER, multiplier)), 3)


def apply_context_to_cli(raw_cli: float, activity_type: str, engagement_score: int | None = None) -> float:
    """Scale a single session's raw CLI score by its activity context."""
    multiplier = compute_context_multiplier(activity_type, engagement_score)
    return round(raw_cli * multiplier, 4)


def apply_context_to_dataframe(
    df,
    activity_col: str = "activity_type",
    engagement_col: str = "engagement_score",
    raw_cli_col: str = "cli_score",
    out_col: str = "cli_score_adjusted",
):
    """Vectorized version for the offline feature-engineering pipeline.

    Rows with no activity_type recorded (older sessions, pre-feature data)
    fall back to a multiplier of 1.0 -- i.e. unchanged raw CLI -- so this
    is safe to run on historical data without dropping rows.

    Expects df to already have activity_col / engagement_col populated.
    See the note in feature_engineering.py about where that join happens.
    """

    def _row_multiplier(row):
        activity_type = row.get(activity_col)
        if activity_type is None or activity_type != activity_type:  # NaN check
            return 1.0
        return compute_context_multiplier(activity_type, row.get(engagement_col))

    df["context_multiplier"] = df.apply(_row_multiplier, axis=1)
    df[out_col] = df[raw_cli_col] * df["context_multiplier"]
    return df