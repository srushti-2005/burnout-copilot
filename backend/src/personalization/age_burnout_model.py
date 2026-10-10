# src/personalization/age_burnout_model.py
"""
Age as CONTEXT for personalization -- never as a burnout-risk factor.

DESIGN DECISION (final)
-----------------------
Age is NOT used in:
  - the CRITIC weights or the CLI score,
  - the XGBoost / Gradient-Boosted burnout model or its SHAP explanations,
  - the Low / Medium / High CLI category thresholds,
  - intervention selection.

Age is used ONLY to choose the starting PRIOR of a user's personalized
baseline (see src/personalization/baseline_prior.py). That prior carries
decreasing weight as the user's own session history accumulates, and it
exists ONLY once enough real users are available in an age band to
estimate a band-specific prior. Until then no prior is applied and the
baseline is exactly the user's own running averages.

WHY THE OLD THRESHOLD SHIFTS WERE REMOVED
-----------------------------------------
The previous version shifted the Medium/High cut-offs by fixed amounts
(e.g. -0.03 / -0.05). No published study supports those numbers, and the
published age-burnout evidence is inconsistent in direction and varies by
occupation, so a fixed shift would be an unsupported Age -> risk
adjustment. The 51-person exploratory survey also showed age associated
with self-reported screen exposure and late-night use, but not with
self-reported post-screen mental fatigue.

BACKWARD COMPATIBILITY
----------------------
`AgeAdjustment`, `get_age_adjustment` and `apply_age_adjustment` are kept
as DEPRECATED NO-OP shims so any caller still importing them keeps
working. They always return zero shifts and never change a threshold.

REFERENCES (verified bibliographic details only; re-check before citing)
------------------------------------------------------------------------
- Gomez-Urquiza, J. L., et al. (2017). Age as a risk factor for burnout
  syndrome in nursing professionals: a meta-analytic study. Research in
  Nursing & Health, 40(2), 99-110. doi:10.1002/nur.21774
- Fischer, D., Lombardi, D. A., Marucci-Wellman, H., & Roenneberg, T.
  (2017). Chronotypes in the US - influence of age and sex. PLOS ONE,
  12(6), e0178782. doi:10.1371/journal.pone.0178782
- Roenneberg, T., et al. (2004). A marker for the end of adolescence.
  Current Biology, 14(24), R1038-R1039. doi:10.1016/j.cub.2004.11.039
- Wasylyshyn, C., Verhaeghen, P., & Sliwinski, M. J. (2011). Aging and
  task switching: a meta-analysis. Psychology and Aging, 26(1), 15-20.
  doi:10.1037/a0020912
"""

from dataclasses import dataclass

# Bands match the survey's answer options.
AGE_BANDS = ("<18", "18-25", "26-40", "41-60", ">60")
UNKNOWN_BAND = "unknown"

_MAX_PLAUSIBLE_AGE = 120


def get_age_band(age) -> str:
    """
    Maps an age to a survey-aligned band. Returns "unknown" for None,
    non-numeric, negative or implausible (> 120) values.
    """
    if age is None or isinstance(age, bool):
        return UNKNOWN_BAND
    try:
        a = int(age)
    except (TypeError, ValueError):
        return UNKNOWN_BAND

    if a < 0 or a > _MAX_PLAUSIBLE_AGE:
        return UNKNOWN_BAND
    if a < 18:
        return "<18"
    if a <= 25:
        return "18-25"
    if a <= 40:
        return "26-40"
    if a <= 60:
        return "41-60"
    return ">60"


# ---------------------------------------------------------------------
# DEPRECATED no-op shims (kept only so older imports do not break)
# ---------------------------------------------------------------------

_NO_ADJUSTMENT_RATIONALE = (
    "No age-based threshold adjustment is applied. Age is used only as "
    "a baseline prior for personalization, never to change CLI "
    "categories or risk."
)


@dataclass(frozen=True)
class AgeAdjustment:
    group_label: str
    medium_threshold_shift: float
    high_threshold_shift: float
    rationale: str


def get_age_adjustment(age: int | None) -> AgeAdjustment:
    """DEPRECATED. Always returns a zero-shift adjustment."""
    return AgeAdjustment(
        group_label=get_age_band(age),
        medium_threshold_shift=0.0,
        high_threshold_shift=0.0,
        rationale=_NO_ADJUSTMENT_RATIONALE,
    )


def apply_age_adjustment(
    medium_threshold: float,
    high_threshold: float,
    age: int | None,
) -> tuple[float, float, AgeAdjustment]:
    """DEPRECATED. Returns the thresholds unchanged."""
    return medium_threshold, high_threshold, get_age_adjustment(age)