# startup_logger.py
"""
Standalone startup logger for Burnout Co-pilot.

Tracks WHOEVER is currently signed in on this computer.
The "active user" lives in .burnout_local_creds.json. It is written by:
  - the backend /auth/login (when the login comes from this machine), or
  - `python startup_logger.py --save-credentials`
and removed by /auth/logout or `--clear-credentials`.
The logger watches that file and switches users automatically.

SETUP (Windows)
  python startup_logger.py --save-credentials   # optional, web login also works
  python startup_logger.py --register-startup   # run once as admin
"""

import sys
import json
import os
import time
import signal
import getpass
import logging
import argparse
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(PROJECT_ROOT))

CREDS_FILE = PROJECT_ROOT / ".burnout_local_creds.json"
POLL_SECONDS = 3          # how often we check who is signed in
WATCHDOG_SECONDS = 30     # how often we check the tracker thread is alive
RETRY_SECONDS = 30        # wait before retrying a failed start

if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

logging.basicConfig(
    level=logging.INFO,
    format="[StartupLogger %(asctime)s] %(message)s",
    datefmt="%H:%M:%S",
    handlers=[
        logging.FileHandler(PROJECT_ROOT / "startup_logger.log", encoding="utf-8"),
        logging.StreamHandler(sys.stdout),
    ],
)
log = logging.getLogger("startup_logger")


# ── credentials file ────────────────────────────────────────────────────────
def save_credentials(uid: str, email: str):
    tmp = CREDS_FILE.with_suffix(".tmp")
    tmp.write_text(json.dumps({"uid": uid, "email": email}), encoding="utf-8")
    os.replace(tmp, CREDS_FILE)  # atomic: the watcher never reads a half-written file
    log.info(f"Credentials saved for {email} ({uid})")


def load_credentials() -> dict | None:
    """Silent read, safe to call every few seconds."""
    try:
        data = json.loads(CREDS_FILE.read_text(encoding="utf-8"))
        if data.get("uid") and data.get("email"):
            return data
    except FileNotFoundError:
        return None
    except Exception as e:
        log.error(f"Failed to read credentials: {e}")
    return None


def clear_credentials():
    if CREDS_FILE.exists():
        CREDS_FILE.unlink()
        log.info("Credentials cleared.")


# ── Windows startup task ────────────────────────────────────────────────────
def register_windows_startup():
    try:
        import subprocess
        python_exe = sys.executable.replace("python.exe", "pythonw.exe")
        script = str(Path(__file__).resolve())
        task_name = "BurnoutCopilotLogger"
        cmd = [
            "schtasks", "/create", "/tn", task_name,
            "/tr", f'"{python_exe}" "{script}"',
            "/sc", "ONLOGON", "/rl", "HIGHEST", "/f",
        ]
        result = subprocess.run(cmd, capture_output=True, text=True)
        if result.returncode == 0:
            log.info(f"Startup task '{task_name}' registered successfully.")
            print("\nDone! PyLogger will now start automatically at every login.")
        else:
            log.error(f"Failed to register task: {result.stderr}")
            print("\nFailed. Try running this script as Administrator.")
    except FileNotFoundError:
        log.error("schtasks not found - this only works on Windows.")


def interactive_save_credentials():
    print("\n-- Burnout Co-pilot: Sign in for tracking --")
    email = input("Email: ").strip()
    password = getpass.getpass("Password: ").strip()

    from src.auth.supabase_client import init_supabase
    init_supabase()
    from src.auth.auth_manager import login
    result = login(email, password)

    if result["success"]:
        save_credentials(result["uid"], result["email"])
        print(f"\nTracking will now record sessions for {result.get('display_name') or email}.")
        print("If the logger is already running it switches within a few seconds.")
    else:
        print(f"\nLogin failed: {result['error']}")


# ── main loop ───────────────────────────────────────────────────────────────
def run_logger():
    log.info("Burnout Co-pilot startup logger initialising...")

    try:
        from src.data import tracker as _t
        log.info(f"[DIAGNOSTIC] tracker.py loaded from: {_t.__file__}")
        log.info(
            f"[DIAGNOSTIC] PYNPUT_OK={_t.PYNPUT_OK} "
            f"PSUTIL_OK={_t.PSUTIL_OK} PYGETWINDOW_OK={_t.PYGETWINDOW_OK}"
        )
    except Exception as e:
        log.error(f"[DIAGNOSTIC] Could not fingerprint tracker module: {e}")

    try:
        from src.auth.supabase_client import init_supabase
        init_supabase()
        log.info("Supabase initialised")
    except Exception as e:
        log.error(f"Supabase init failed: {e}")
        sys.exit(1)

    from src.data.tracker import start_tracker, stop_tracker, is_running

    running = True

    def _quit(*_):
        nonlocal running
        running = False

    signal.signal(signal.SIGINT, _quit)
    if hasattr(signal, "SIGTERM"):
        signal.signal(signal.SIGTERM, _quit)

    current_uid: str | None = None
    retry_at = 0.0
    last_watchdog = time.time()
    announced_waiting = False

    log.info(f"Watching {CREDS_FILE.name} for the signed-in user...")

    while running:
        creds = load_credentials()
        uid = creds["uid"] if creds else None
        now = time.time()

        if uid != current_uid and now >= retry_at:
            try:
                if is_running():
                    log.info(f"Stopping tracker for uid={current_uid} (saving its session)")
                    stop_tracker()
                    time.sleep(1.0)
                if uid:
                    start_tracker(uid)
                    log.info(f"Tracking started for {creds['email']} (uid={uid})")
                    announced_waiting = False
                else:
                    log.info("No user signed in - tracking paused.")
                current_uid = uid
            except Exception as e:
                log.error(f"Could not switch tracker to uid={uid}: {e}")
                retry_at = now + RETRY_SECONDS

        elif uid is None and not announced_waiting:
            log.info("Waiting for a user to sign in (web app or --save-credentials)...")
            announced_waiting = True

        elif uid and uid == current_uid and now - last_watchdog >= WATCHDOG_SECONDS:
            last_watchdog = now
            try:
                if not is_running():
                    log.warning("Tracker thread not running - restarting.")
                    start_tracker(uid)
            except Exception as e:
                log.error(f"Tracker watchdog failed: {e}")

        time.sleep(POLL_SECONDS)

    log.info("Startup logger stopping.")
    try:
        stop_tracker()
    except Exception:
        pass


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Burnout Co-pilot Startup Logger")
    parser.add_argument("--save-credentials", action="store_true",
                        help="Sign in and make this user the tracked user")
    parser.add_argument("--register-startup", action="store_true",
                        help="Register as a Windows startup task (run as admin)")
    parser.add_argument("--clear-credentials", "--logout", action="store_true", dest="clear",
                        help="Sign out: stop tracking until someone signs in")
    args = parser.parse_args()

    if args.save_credentials:
        interactive_save_credentials()
    elif args.register_startup:
        register_windows_startup()
    elif args.clear:
        clear_credentials()
    else:
        run_logger()