# src/personalization/build_band_priors.py
"""
Learns age-band baseline priors from YOUR OWN users -- no hand-set numbers.

For each age band: the average of established users' running baselines
(users with >= MIN_SESSIONS sessions), shrunk toward the pooled average
across all bands so small bands cannot produce extreme priors:

    prior_band = (n * band_mean + K0 * pooled_mean) / (n + K0)

Only features where the exploratory survey found an age association are
learned (late-night use and work/screen duration). Typing and
task-switching are deliberately excluded: the survey showed age
associated with exposure habits, not with fatigue, and the literature on
age and task switching comes from lab paradigms that do not map onto
logged app switching.

A band's prior is only USED at runtime once it has MIN_USERS_PER_BAND
users (see baseline_prior.py). Output holds aggregates only: no user ids
or ages.

Run from the project root, then restart the API:
    python -m src.personalization.build_band_priors
"""

import json
import os
from datetime import datetime, timezone
from typing import Iterable, Mapping

from src.personalization.age_burnout_model import UNKNOWN_BAND, get_age_band
from src.personalization.baseline_prior import BAND_PRIORS_PATH, MIN_USERS_PER_BAND

PRIOR_FEATURES = ("late_night", "work_duration")
MIN_SESSIONS = 5          # established baselines only
SHRINKAGE_K0 = 10.0       # tunable regulariser; run a sensitivity check


def compute_band_priors(
    users: Iterable[Mapping],
    features=PRIOR_FEATURES,
    min_sessions: int = MIN_SESSIONS,
    k0: float = SHRINKAGE_K0,
) -> dict:
    """
    users: dicts with "age", "session_count" and "<feature>_avg" keys.
    Returns {band: {"n_users": int, "means": {feature: float}}}.
    """
    user_counts: dict[str, int] = {}
    values: dict[str, dict[str, list]] = {}

    for u in users:
        band = get_age_band(u.get("age"))
        if band == UNKNOWN_BAND:
            continue
        try:
            n_sessions = int(u.get("session_count") or 0)
        except (TypeError, ValueError):
            continue
        if n_sessions < min_sessions:
            continue

        user_counts[band] = user_counts.get(band, 0) + 1
        for f in features:
            try:
                v = float(u.get(f"{f}_avg"))
            except (TypeError, ValueError):
                continue
            if v != v:  # NaN
                continue
            values.setdefault(band, {}).setdefault(f, []).append(v)

    pooled: dict[str, float] = {}
    for f in features:
        allv = [v for band_vals in values.values() for v in band_vals.get(f, [])]
        if allv:
            pooled[f] = sum(allv) / len(allv)

    bands: dict = {}
    for band, n in user_counts.items():
        means = {}
        for f, vals in values.get(band, {}).items():
            nf = len(vals)
            band_mean = sum(vals) / nf
            means[f] = (nf * band_mean + k0 * pooled[f]) / (nf + k0)
        if means:
            bands[band] = {"n_users": n, "means": means}
    return bands


def save_band_priors(bands: dict, path: str = BAND_PRIORS_PATH,
                     k0: float = SHRINKAGE_K0, min_sessions: int = MIN_SESSIONS) -> str:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    payload = {
        "meta": {
            "generated_at_utc": datetime.now(timezone.utc).isoformat(),
            "features": list(PRIOR_FEATURES),
            "min_sessions_per_user": min_sessions,
            "shrinkage_k0": k0,
            "min_users_per_band_to_use": MIN_USERS_PER_BAND,
        },
        "bands": bands,
    }
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(payload, fh, indent=2)
    return path


def _fetch_all(sb, table: str, columns: str, page: int = 1000) -> list:
    out: list = []
    start = 0
    while True:
        res = sb.table(table).select(columns).range(start, start + page - 1).execute()
        rows = res.data or []
        out.extend(rows)
        if len(rows) < page:
            break
        start += page
    return out


def fetch_users(sb) -> list:
    """Joins profiles (age) with user_baselines (running averages)."""
    profiles = _fetch_all(sb, "profiles", "id,age")
    ages = {p["id"]: p.get("age") for p in profiles}
    cols = "user_id,session_count," + ",".join(f"{f}_avg" for f in PRIOR_FEATURES)
    users = []
    for b in _fetch_all(sb, "user_baselines", cols):
        users.append({**b, "age": ages.get(b["user_id"])})
    return users


def main() -> None:
    from src.auth.supabase_client import get_service_client  # lazy import

    users = fetch_users(get_service_client())
    bands = compute_band_priors(users)
    path = save_band_priors(bands)

    print(f"Wrote {path}")
    for band, entry in sorted(bands.items()):
        usable = "USED at runtime" if entry["n_users"] >= MIN_USERS_PER_BAND else "too few users, not used"
        means = ", ".join(f"{k}={v:.3f}" for k, v in entry["means"].items())
        print(f"  {band:6s} n={entry['n_users']:3d}  {means}  -> {usable}")
    if not bands:
        print("  No established users with an age yet; nothing will be applied.")


if __name__ == "__main__":
    main()