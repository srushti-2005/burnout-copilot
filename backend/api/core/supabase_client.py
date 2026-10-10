# api/core/supabase_client.py
import sys
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent.parent
if str(BASE_DIR) not in sys.path:
    sys.path.insert(0, str(BASE_DIR))

from src.auth.supabase_client import get_service_client, get_auth_client  # noqa: F401