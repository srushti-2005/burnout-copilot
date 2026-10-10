"""
Intervention Engine (Phase 5).

Turns "High risk -> warning" into "High risk -> understand cause -> choose
action" by reusing infrastructure that already exists in this project
instead of introducing a new model:

  - The CRITIC weights + normalized features already computed for the CLI
    score (src/cli_logic.py) stand in for a feature-importance signal.
    This is the same "weight x normalized value" ranking that
    api/routers/dashboard.py's _build_drivers() already uses. We are not
    adding a SHAP dependency here, because the CRITIC weights already give
    a defensible, already-validated per-feature contribution to the CLI
    number itself. If you later want true SHAP values (e.g. from a trained
    model over historical sessions instead of the fixed CRITIC formula),
    find_primary_contributor() is the one function to replace -- the
    mapping, message, and API shape below all stay the same.
  - The Digital Twin's baseline deviations (services/digital_twin.py) for
    "is this actually unusual for THIS person", which is what makes the
    intervention personalized rather than a blanket population threshold.

This module is a PURE function: build_intervention() takes plain dicts in
and returns a plain dict out, so it's easy to unit test without touching
Supabase. api/routers/interventions.py is the only place that touches the
database.
"""
from __future__ import annotations

from typing import Optional

FEATURE_LABELS = {
    "typing_mean": "Typing speed",
    "typing_variance": "Typing irregularity",
    "task_switching": "Task switching",
    "work_duration": "Session length",
    "late_night": "Late-night work",
}

# Step 4: contributor -> intervention.
INTERVENTION_CATALOG = {
    "task_switching": {
        "type": "focus_protection",
        "title": "Focus Protection",
        "action_label": "Start Focus Protection — 20 minutes",
        "ui_action": {"kind": "focus_protection", "duration_min": 20},
    },
    "work_duration": {
        "type": "break_recommendation",
        "title": "Take a break",
        "action_label": "Step away for 10-15 minutes",
        "ui_action": {"kind": "break", "duration_min": 15},
    },
    "late_night": {
        "type": "recovery_window",
        "title": "Protect your recovery window",
        "action_label": "Wrap up and rest before your next session",
        "ui_action": {"kind": "recovery"},
    },
    "typing_variance": {
        "type": "short_pause",
        "title": "Take a short pause",
        "action_label": "Pause for a few minutes before continuing",
        "ui_action": {"kind": "break", "duration_min": 5},
    },
    "typing_mean": {
        "type": "pace_check",
        "title": "Check your pace",
        "action_label": "Take this next task at an easier pace",
        "ui_action": {"kind": "break", "duration_min": 5},
    },
}

# A feature only becomes a candidate strongly if it is BOTH a large share
# of the current CLI AND unusual for this specific person, so a feature
# that's simply this user's normal (e.g. someone who always works late)
# doesn't get flagged as "the cause" every single day.
DEVIATION_STATUS_WEIGHT = {
    "above_normal": 1.0,
    "below_normal": 0.4,
    "normal": 0.0,
}


def find_primary_contributor(
    current_norm: dict,
    weights: dict,
    deviations: dict,
) -> Optional[str]:
    """
    Step 3. Ranks each tracked feature by:
        score = (weight x normalized value) x deviation_weight

    Returns None if nothing scores above zero (e.g. no baseline yet and
    all normalized values are at the low end).
    """
    scored: list[tuple[str, float]] = []
    for feat in FEATURE_LABELS:
        weight_key = "late_night" if feat == "late_night" else f"{feat}_norm"
        norm_key = "late_night" if feat == "late_night" else f"{feat}_norm"
        if weight_key not in weights or norm_key not in current_norm:
            continue

        norm_val = current_norm[norm_key]
        if norm_val is None:
            continue
        base_contribution = weights[weight_key] * norm_val

        dev_status = (deviations or {}).get(feat, {}).get("status", "normal")
        # Without an established baseline, fall back to raw contribution
        # only (no personalization boost/penalty).
        dev_weight = DEVIATION_STATUS_WEIGHT.get(dev_status, 0.0) if deviations else 1.0

        score = base_contribution * dev_weight
        if score > 0:
            scored.append((feat, score))

    if not scored:
        return None
    scored.sort(key=lambda kv: kv[1], reverse=True)
    return scored[0][0]


def _explain(feat: str, deviations: dict) -> str:
    """Step 5 (the 'why'), in plain language, using the twin's own numbers."""
    dev = (deviations or {}).get(feat)
    label = FEATURE_LABELS.get(feat, feat)
    if dev and dev.get("status") == "above_normal" and dev.get("difference_pct") is not None:
        return f"{label} is {abs(dev['difference_pct'])}% above your usual pattern."
    if dev and dev.get("status") == "below_normal" and dev.get("difference_pct") is not None:
        return f"{label} is {abs(dev['difference_pct'])}% below your usual pattern."
    return f"{label} is the largest contributor to your current score today."


def build_intervention(
    current_norm: Optional[dict],
    weights: dict,
    deviations: dict,
    cli: Optional[float],
    risk_level: str,
) -> Optional[dict]:
    """
    Steps 1-6. Returns None when there isn't enough live data yet (e.g. no
    sessions today) -- callers should treat that as "nothing to recommend
    right now", not an error.

    Non-diagnostic by construction: everything returned describes behavior
    ("task switching", "session length") and never a clinical or burnout
    diagnosis.
    """
    if not current_norm:
        return None

    contributor = find_primary_contributor(current_norm, weights, deviations)
    if contributor is None:
        return None

    catalog_entry = INTERVENTION_CATALOG.get(contributor)
    if catalog_entry is None:
        return None

    label = FEATURE_LABELS.get(contributor, contributor)

    return {
        "contributor": contributor,
        "contributor_label": label,
        "risk_level": risk_level,
        "cli": cli,
        "intervention_type": catalog_entry["type"],
        "title": catalog_entry["title"],
        "what": f"Your {label.lower()} looks like the main driver of your current {risk_level.lower()} risk reading.",
        "why": _explain(contributor, deviations),
        "action_label": catalog_entry["action_label"],
        "ui_action": catalog_entry["ui_action"],
    }