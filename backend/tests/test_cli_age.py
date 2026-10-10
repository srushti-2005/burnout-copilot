from src.cli_logic import categorize_cli
from src.personalization.age_burnout_model import get_age_adjustment
from src.personalization.age_burnout_model import apply_age_adjustment


def test_categorize_without_age():
    assert categorize_cli(0.72) == "High"


def test_categorize_with_age_none():
    assert categorize_cli(0.72, age=None) == "High"


def test_age_25_does_not_change_interpretation():
    assert categorize_cli(0.68, age=25) == "Medium"


def test_age_37_keeps_original_threshold():
    assert categorize_cli(0.68, age=37) == "Medium"


def test_age_50_does_not_change_interpretation():
    assert categorize_cli(0.68, age=50) == "Medium"


def test_age_60_no_adjustment():
    assert categorize_cli(0.68, age=60) == "Medium"


def test_age_17_does_not_change_interpretation():
    assert categorize_cli(0.68, age=17) == "Medium"


def test_age_150_does_not_change_interpretation():
    assert categorize_cli(0.68, age=150) == "Medium"