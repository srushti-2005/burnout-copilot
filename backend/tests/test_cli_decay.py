import sys
from pathlib import Path
from datetime import datetime, timezone, timedelta

_BASE = Path(__file__).resolve().parent.parent
if str(_BASE / "api") not in sys.path:
    sys.path.insert(0, str(_BASE / "api"))
if str(_BASE) not in sys.path:
    sys.path.insert(0, str(_BASE))

from src.data.supabase_manager import _compute_cli_for_row
from api.routers.dashboard import get_dashboard


def test_cli_reading_inactivity_floor():
    """Verify that when the user is reading without typing, CLI maintains realistic floor."""
    row = {
        "typing_mean": 0,
        "typing_variance": 0,
        "task_switching": 0,
        "work_duration": 0.5,
        "late_night": 0,
    }
    cli_raw, cli_adj, risk = _compute_cli_for_row(row)
    assert cli_adj >= 0.08, f"Expected CLI >= 0.08 during reading, got {cli_adj}"
    assert risk == "Low"


def test_cli_no_sudden_drops():
    """Verify that CLI score does not crash suddenly from 29 straight to 0."""
    now = datetime.now(timezone.utc)
    prev = {
        "cli_score": 0.29,
        "cli_score_raw": 0.29,
        "created_at": (now - timedelta(minutes=10)).isoformat(),
    }
    # User is reading and not typing for 10 minutes
    reading_row = {
        "typing_mean": 0,
        "typing_variance": 0,
        "task_switching": 0,
        "work_duration": 0.5,
        "late_night": 0,
    }
    cli_raw, cli_adj, risk = _compute_cli_for_row(reading_row, prev_session=prev)
    # The drop should be gradual (1-2% at a time), not a crash to zero
    assert cli_adj >= 0.25, f"Expected gradual decrease from 0.29, but got {cli_adj}"
    assert cli_adj <= 0.29, f"Expected decrease, got {cli_adj}"


def test_energy_never_100_percent():
    """Verify that energy is realistic and never 100% when working/reading."""
    d = get_dashboard("58d2bde9-5b03-43eb-a176-6ac280e34aa3")
    energy_str = d["energy_level"]
    energy_val = int(energy_str.replace("%", ""))
    assert energy_val <= 88, f"Energy should never exceed 88% realistic human max, got {energy_val}%"
    assert energy_val >= 25, f"Energy should stay above minimum floor, got {energy_val}%"
