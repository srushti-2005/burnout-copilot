
import sys
from pathlib import Path
from datetime import datetime, timezone, timedelta

_BASE = Path(__file__).resolve().parent.parent

if str(_BASE / "api") not in sys.path:
    sys.path.insert(0, str(_BASE / "api"))

if str(_BASE) not in sys.path:
    sys.path.insert(0, str(_BASE))

from src.data.supabase_manager import _compute_cli_for_row
from api.routers import dashboard



def test_cli_zero_when_all_activity_signals_are_zero():
    """CLI should be zero when all activity signals are zero."""
    row = {
        "typing_mean": 0,
        "typing_variance": 0,
        "task_switching": 0,
        "work_duration": 0.5,
        "late_night": 0,
    }

    cli_raw, cli_adj, risk = _compute_cli_for_row(row)

    assert cli_raw == 0.0, f"Expected raw CLI 0, got {cli_raw}"
    assert cli_adj == 0.0, f"Expected adjusted CLI 0, got {cli_adj}"


def test_cli_decays_when_activity_stops():
    """CLI should decay when the user stops showing activity signals."""
    now = datetime.now(timezone.utc)

    prev = {
        "cli_score": 0.29,
        "cli_score_raw": 0.29,
        "created_at": (now - timedelta(minutes=10)).isoformat(),
    }

    reading_row = {
        "typing_mean": 0,
        "typing_variance": 0,
        "task_switching": 0,
        "work_duration": 0.5,
        "late_night": 0,
    }

    cli_raw, cli_adj, risk = _compute_cli_for_row(
        reading_row,
        prev_session=prev,
    )
    assert 0.0 <= cli_raw < 0.29, (
    f"Expected raw CLI to decay below 0.29, got {cli_raw}"
    )
    assert 0.0 <= cli_adj < 0.29, (
    f"Expected adjusted CLI to decay below 0.29, got {cli_adj}"
    )


def test_energy_never_100_percent(monkeypatch):
    """Verify that dashboard energy stays within realistic limits."""

    user_id = "58d2bde9-5b03-43eb-a176-6ac280e34aa3"

    # Avoid real Supabase calls in this unit test.
    monkeypatch.setattr(
        dashboard,
        "_fetch_sessions",
        lambda uid: [],
    )
    monkeypatch.setattr(
        dashboard,
        "_user_profile",
        lambda uid: {
            "uid": uid,
            "email": "",
            "display_name": "",
        },
    )
    monkeypatch.setattr(
        dashboard,
        "get_or_create_baseline",
        lambda uid: {},
    )

    # Call the function with an actual UUID, bypassing FastAPI's
    # dependency injection for this unit test.
    result = dashboard.get_dashboard(
        tz="UTC",
        user_id=user_id,
    )

    energy_str = result["energy_level"]
    energy_val = int(energy_str.replace("%", ""))

    assert energy_val <= 88, (
        f"Energy should never exceed 88%, got {energy_val}%"
    )
    assert energy_val >= 25, (
        f"Energy should stay above 25%, got {energy_val}%"
    )
