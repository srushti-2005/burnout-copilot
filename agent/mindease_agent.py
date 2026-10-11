"""
MindEase PC agent.

Runs on a tester's own Windows PC. It:
  1. listens ONLY on 127.0.0.1 for the MindEase website (allow-listed origins),
  2. receives the user's own login tokens from the website after sign-in,
  3. starts the existing tracker (tracker.py) for that user,
  4. uploads each finished session to the deployed API (POST /sessions) with the
     USER'S token. The API works out the user from the token, so a session can
     only ever be saved under the account that is signed in.

This program NEVER contains or needs the Supabase service-role key.
Typing is recorded as counts per minute only (never which keys).

Usage
  MindEaseAgent.exe              first double-click installs + starts; later launches just run
  MindEaseAgent.exe --uninstall  remove autostart, sign out, stop the agent
  python mindease_agent.py --run [--interval-minutes 2]   run in a console (development)
"""
import sys
import os

# --noconsole builds have no stdout/stderr; make them harmless before anything logs.
if sys.stdout is None:
    sys.stdout = open(os.devnull, "w")
if sys.stderr is None:
    sys.stderr = open(os.devnull, "w")

import json
import time
import base64
import shutil
import logging
import argparse
import threading
import subprocess
from pathlib import Path
from logging.handlers import RotatingFileHandler
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib import request as urlrequest, error as urlerror
from urllib.parse import urlparse

# ───────────────────────── CONFIG: edit these two before building ─────────────────────────
API_URL = os.environ.get("MINDEASE_API_URL", "https://burnout-copilot.onrender.com").rstrip("/")
ALLOWED_ORIGINS = {
    o.strip().rstrip("/")
    for o in os.environ.get(
        "MINDEASE_ORIGINS",
        "https://burnout-copilot.vercel.app,https://burnout-copilot-git-main-srushtiii2005-1873s-projects.vercel.app,http://localhost:3000,http://localhost:5173",
    ).split(",")
    if o.strip()
}
SUPABASE_URL = "https://yljtzzqbztuxjnztautv.supabase.co"
SUPABASE_ANON_KEY = (
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlsanR6enFienR1"
    "eGpuenRhdXR2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODYxNjMwMjksImV4cCI6MjEwMTczOTAyOX0."
    "_dGYLLrYeHmR7JepcCI-z-h9L07cASEcwMSXDAu0GPc"
)
# ───────────────────────────────────────────────────────────────────────────────────────────

PORT = 47821
VERSION = "1.0.0"
DEFAULT_INTERVAL_MINUTES = 2.0   # 2 minutes for testing sessions quickly; override with --interval-minutes 60
WATCHDOG_SECONDS = 30
EXE_NAME = "MindEaseAgent.exe"
RUN_KEY = r"Software\Microsoft\Windows\CurrentVersion\Run"
RUN_VALUE = "MindEaseAgent"

APP_DIR = Path(os.environ.get("LOCALAPPDATA") or (Path.home() / ".mindease")) / "MindEase"
APP_DIR.mkdir(parents=True, exist_ok=True)
STATE_FILE = APP_DIR / "agent.json"
LOG_FILE = APP_DIR / "agent.log"

_handler = RotatingFileHandler(LOG_FILE, maxBytes=500_000, backupCount=2, encoding="utf-8")
logging.basicConfig(
    level=logging.INFO,
    format="[MindEaseAgent %(asctime)s] %(message)s",
    datefmt="%H:%M:%S",
    handlers=[_handler],
)
log = logging.getLogger("mindease_agent")

# tracker.py (same file the backend repo already has). Imported after logging is set up.
try:
    import tracker  # copied next to this file when building the exe
except ImportError:
    _backend_dir = Path(__file__).resolve().parent.parent / "backend"
    if str(_backend_dir) not in sys.path:
        sys.path.insert(0, str(_backend_dir))
    try:
        from src.data import tracker  # running from the backend folder in development
    except ImportError:
        import tracker


# ───────────────────────── small helpers ─────────────────────────
def _popup(text: str, title: str = "MindEase") -> None:
    try:
        import ctypes
        ctypes.windll.user32.MessageBoxW(0, text, title, 0x40)
    except Exception:
        print(text)


def _jwt_payload(token: str) -> dict:
    try:
        part = token.split(".")[1]
        part += "=" * (-len(part) % 4)
        return json.loads(base64.urlsafe_b64decode(part))
    except Exception:
        return {}


def _jwt_exp(token: str) -> int:
    return int(_jwt_payload(token).get("exp", 0))


def _http(method: str, path: str, body=None, token: str | None = None, timeout: int = 40):
    """Returns (status, parsed_json_or_None). Raises only on network failure."""
    data = json.dumps(body).encode("utf-8") if body is not None else None
    req = urlrequest.Request(API_URL + path, data=data, method=method)
    req.add_header("Content-Type", "application/json")
    req.add_header("User-Agent", f"MindEaseAgent/{VERSION}")
    if token:
        req.add_header("Authorization", f"Bearer {token}")
    try:
        with urlrequest.urlopen(req, timeout=timeout) as r:
            raw, status = r.read(), r.status
    except urlerror.HTTPError as e:
        raw, status = e.read(), e.code
    except Exception as e:
        log.warning(f"HTTP {method} {path} failed: {e}")
        return 0, None
    try:
        parsed = json.loads(raw)
    except Exception:
        parsed = None
    return status, parsed


# ───────────────────────── signed-in user state ─────────────────────────
_lock = threading.RLock()
_state: dict = {}   # uid, email, access_token, refresh_token


def _load_state() -> None:
    global _state
    try:
        _state = json.loads(STATE_FILE.read_text(encoding="utf-8"))
        if not (_state.get("uid") and _state.get("access_token")):
            _state = {}
    except FileNotFoundError:
        _state = {}
    except Exception as e:
        log.error(f"could not read state: {e}")
        _state = {}


def _save_state() -> None:
    tmp = STATE_FILE.with_suffix(".tmp")
    tmp.write_text(json.dumps(_state), encoding="utf-8")
    os.replace(tmp, STATE_FILE)  # atomic


def _stop_tracking() -> None:
    try:
        if tracker.is_running():
            tracker.stop_tracker()
            t = getattr(tracker, "_tracker_thread", None)
            # Never join ourselves: sign-out can be triggered from the tracker thread.
            if t is not None and t is not threading.current_thread():
                t.join(timeout=5)
    except Exception as e:
        log.error(f"stop tracker failed: {e}")


def _clear_state() -> None:
    global _state
    with _lock:
        _state = {}
        try:
            STATE_FILE.unlink(missing_ok=True)
        except Exception as e:
            log.error(f"could not delete state file: {e}")
    _stop_tracking()


def _refresh_locked() -> None:
    """Swap the refresh token for fresh tokens via the API or directly via Supabase. Caller holds _lock."""
    rt = _state.get("refresh_token")
    if not rt:
        return

    # 1. Try backend API /auth/refresh
    status, out = _http("POST", "/auth/refresh", {"refresh_token": rt})
    if status == 200 and out and out.get("success") and out.get("access_token"):
        _state["access_token"] = out["access_token"]
        if out.get("refresh_token"):
            _state["refresh_token"] = out["refresh_token"]
        _save_state()
        return

    # 2. If backend returns 404/500 or is sleeping, refresh directly via Supabase Auth
    try:
        url = f"{SUPABASE_URL}/auth/v1/token?grant_type=refresh_token"
        req = urlrequest.Request(
            url,
            data=json.dumps({"refresh_token": rt}).encode("utf-8"),
            headers={"Content-Type": "application/json", "apikey": SUPABASE_ANON_KEY},
            method="POST",
        )
        with urlrequest.urlopen(req, timeout=15) as r:
            data = json.loads(r.read())
            if data.get("access_token"):
                _state["access_token"] = data["access_token"]
                if data.get("refresh_token"):
                    _state["refresh_token"] = data["refresh_token"]
                _save_state()
                log.info("Refreshed tokens directly with Supabase")
                return
    except Exception as e:
        log.warning(f"Direct Supabase token refresh failed: {e}")

    if status in (400, 401, 403, 422):
        log.warning("session no longer valid; signing out of the agent")
        _clear_state()
        raise RuntimeError("signed out: session expired")
    raise RuntimeError(f"temporary API problem ({status}); will retry")


def _get_token(force: bool = False) -> str:
    with _lock:
        tok = _state.get("access_token")
        if not tok:
            raise RuntimeError("not signed in")
        if force or _jwt_exp(tok) - time.time() < 120:
            if _state.get("refresh_token"):
                try:
                    _refresh_locked()
                except Exception as e:
                    log.warning(f"refresh attempt: {e}")
        return _state["access_token"]


def save_via_api(uid: str, data: dict):
    """Replacement for supabase_manager.save_session. Raises on failure so the
    tracker keeps this interval's counters and tries again next cycle."""
    with _lock:
        if _state.get("uid") != uid:
            raise RuntimeError("tracked user changed; refusing to upload")
    payload = {
        "typing_mean":     float(data.get("typing_mean", 0)),
        "typing_variance": float(data.get("typing_variance", 0)),
        "task_switching":  int(data.get("task_switching", 0)),
        "work_duration":   float(data.get("work_duration", 0)),
        "late_night":      int(bool(data.get("late_night", 0))),
    }
    status, out = _http("POST", "/sessions", payload, token=_get_token())
    if status == 401:
        status, out = _http("POST", "/sessions", payload, token=_get_token(force=True))
    if status >= 300 or status == 0:
        raise RuntimeError(f"API returned {status} while saving session")
    log.info(f"Session saved successfully: {out.get('id') if isinstance(out, dict) else out}")
    return out


def ensure_tracking() -> None:
    with _lock:
        uid = _state.get("uid")
    if uid and not tracker.is_running():
        tracker.set_saver(save_via_api)
        tracker.start_tracker(uid)
        log.info(f"tracking started for {_state.get('email')}")


def apply_login(access_token: str, refresh_token: str | None = None) -> dict:
    """Verify user identity from API or token payload, then save state and start tracking."""
    uid = None
    email = None

    # 1. If refresh token provided, try /auth/refresh
    if refresh_token:
        status, out = _http("POST", "/auth/refresh", {"refresh_token": refresh_token})
        if status == 200 and out and out.get("success") and out.get("uid"):
            uid = out["uid"]
            email = out.get("email")
            access_token = out.get("access_token", access_token)
            refresh_token = out.get("refresh_token", refresh_token)

    # 2. If not verified yet, verify access_token via /auth/profile on API
    if not uid:
        status, out = _http("GET", "/auth/profile", token=access_token)
        if status == 200 and isinstance(out, dict) and out.get("id"):
            uid = out["id"]
            email = out.get("email")

    # 3. Fallback: decode claims directly from the JWT payload
    if not uid:
        payload = _jwt_payload(access_token)
        exp = int(payload.get("exp", 0))
        if exp > time.time() and payload.get("sub"):
            uid = payload["sub"]
            email = payload.get("email")

    if not uid:
        raise ValueError("could not verify sign-in credentials")

    with _lock:
        changed = _state.get("uid") != uid
        if changed:
            _stop_tracking()
        _state.clear()
        _state["uid"] = uid
        _state["email"] = email
        _state["access_token"] = access_token
        if refresh_token:
            _state["refresh_token"] = refresh_token
        _save_state()
    ensure_tracking()
    log.info(f"Signed in as {email or uid}; tracking active")
    return {"email": email or ""}


def apply_logout() -> None:
    _clear_state()
    log.info("signed out; tracking stopped")


def _watchdog() -> None:
    while True:
        time.sleep(WATCHDOG_SECONDS)
        try:
            ensure_tracking()
        except Exception as e:
            log.error(f"watchdog: {e}")


# ───────────────────────── localhost server ─────────────────────────
class Handler(BaseHTTPRequestHandler):
    server_version = "MindEaseAgent"

    def log_message(self, *args):  # silence default stderr logging
        pass

    def _host_ok(self) -> bool:
        # Blocks DNS-rebinding: the Host header must be the loopback address we bound to.
        return self.headers.get("Host", "").lower() in {f"127.0.0.1:{PORT}", f"localhost:{PORT}"}

    def _origin(self) -> str | None:
        o = (self.headers.get("Origin") or "").rstrip("/")
        if not o:
            return None
        if o in ALLOWED_ORIGINS:
            return o
        try:
            p = urlparse(o)
            host = (p.hostname or "").lower()
            if host in ("localhost", "127.0.0.1") or host.endswith(".vercel.app"):
                return o
        except Exception:
            pass
        return None

    def _send(self, code: int, obj=None, origin: str | None = None):
        body = b"" if obj is None else json.dumps(obj).encode("utf-8")
        try:
            self.send_response(code)
            if origin:
                self.send_header("Access-Control-Allow-Origin", origin)
                self.send_header("Vary", "Origin")
                self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
                self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
                self.send_header("Access-Control-Allow-Private-Network", "true")
                self.send_header("Access-Control-Max-Age", "600")
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            if body:
                self.wfile.write(body)
        except Exception:
            pass  # the browser tab may already have navigated away

    def do_OPTIONS(self):
        origin = self._origin()
        if not self._host_ok() or not origin:
            return self._send(403, {"error": "forbidden"})
        self._send(204, None, origin)

    def do_GET(self):
        origin = self._origin()
        if not self._host_ok() or not origin:
            return self._send(403, {"error": "forbidden"})
        if self.path.split("?")[0] != "/status":
            return self._send(404, {"error": "not found"}, origin)
        with _lock:
            email = _state.get("email")
        self._send(200, {"ok": True, "version": VERSION, "email": email,
                         "tracking": tracker.is_running()}, origin)

    def do_POST(self):
        origin = self._origin()
        if not self._host_ok() or not origin:
            return self._send(403, {"error": "forbidden"})
        path = self.path.split("?")[0]
        try:
            n = int(self.headers.get("Content-Length") or 0)
            if n > 16_384:
                return self._send(413, {"error": "too large"}, origin)
            body = json.loads(self.rfile.read(n) or b"{}")
        except Exception:
            return self._send(400, {"error": "bad request"}, origin)

        if path == "/login":
            at, rt = body.get("access_token"), body.get("refresh_token")
            if not (isinstance(at, str) and len(at) >= 10):
                return self._send(400, {"error": "missing access token"}, origin)
            try:
                info = apply_login(at, rt if isinstance(rt, str) else None)
                return self._send(200, {"ok": True, **info}, origin)
            except Exception as e:
                log.warning(f"login handoff failed: {e}")
                return self._send(502, {"ok": False, "error": str(e)}, origin)
        if path == "/logout":
            apply_logout()
            return self._send(200, {"ok": True}, origin)
        self._send(404, {"error": "not found"}, origin)


class AgentServer(ThreadingHTTPServer):
    allow_reuse_address = True
    daemon_threads = True


def run_agent(interval_minutes: float) -> None:
    # tracker.py's interval setup.
    # INTERVAL_SECONDS must be an int: the typing-bucket maths breaks with a float.
    tracker.INTERVAL_HOURS = interval_minutes / 60.0
    tracker.INTERVAL_SECONDS = max(60, int(round(interval_minutes * 60)))

    server = None
    for _ in range(5):
        try:
            server = AgentServer(("127.0.0.1", PORT), Handler)
            break
        except OSError:
            time.sleep(1)

    if not server:
        log.info("port already in use: another agent is running; exiting")
        return

    _load_state()
    try:
        ensure_tracking()
    except Exception as e:
        log.error(f"could not resume tracking: {e}")
    threading.Thread(target=_watchdog, name="agent_watchdog", daemon=True).start()
    log.info(f"agent v{VERSION} listening on 127.0.0.1:{PORT}; API={API_URL}; "
             f"interval={interval_minutes} min; origins={sorted(ALLOWED_ORIGINS)}")
    try:
        server.serve_forever()
    finally:
        _stop_tracking()


# ───────────────────────── install / uninstall (Windows) ─────────────────────────
def _install_and_launch() -> None:
    import winreg
    target = APP_DIR / EXE_NAME
    if getattr(sys, "frozen", False):
        if Path(sys.executable).resolve() != target.resolve():
            _kill_other_agents()
            shutil.copy2(sys.executable, target)
        cmd = f'"{target}"'
        launch = [str(target)]
    else:
        pyw = Path(sys.executable.replace("python.exe", "pythonw.exe"))
        cmd = f'"{pyw}" "{Path(__file__).resolve()}"'
        launch = [str(pyw), str(Path(__file__).resolve())]
    with winreg.CreateKey(winreg.HKEY_CURRENT_USER, RUN_KEY) as k:
        winreg.SetValueEx(k, RUN_VALUE, 0, winreg.REG_SZ, cmd)
    flags = 0x00000008 | 0x00000200 | 0x08000000  # DETACHED | NEW_PROCESS_GROUP | NO_WINDOW
    subprocess.Popen(launch, creationflags=flags, close_fds=True)
    log.info(f"installed to {target if getattr(sys, 'frozen', False) else 'script mode'}")


def _kill_other_agents() -> None:
    try:
        subprocess.run(
            ["taskkill", "/F", "/IM", EXE_NAME, "/FI", f"PID ne {os.getpid()}"],
            capture_output=True, creationflags=0x08000000,
        )
        time.sleep(1)
    except Exception:
        pass


def _uninstall() -> None:
    import winreg
    try:
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, RUN_KEY, 0, winreg.KEY_SET_VALUE) as k:
            winreg.DeleteValue(k, RUN_VALUE)
    except FileNotFoundError:
        pass
    try:
        STATE_FILE.unlink(missing_ok=True)
    except Exception:
        pass
    _kill_other_agents()
    _popup("MindEase agent removed. Tracking has stopped.\n"
           f"You can now delete the folder:\n{APP_DIR}")


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description="MindEase PC agent")
    ap.add_argument("--run", action="store_true", help="run in this process (development)")
    ap.add_argument("--uninstall", action="store_true")
    ap.add_argument("--interval-minutes", type=float,
                    default=float(os.environ.get("MINDEASE_INTERVAL_MINUTES", DEFAULT_INTERVAL_MINUTES)))
    args = ap.parse_args()

    if args.uninstall:
        _uninstall()
    elif args.run:
        run_agent(args.interval_minutes)
    elif sys.platform == "win32" and getattr(sys, "frozen", False) \
            and Path(sys.executable).resolve() != (APP_DIR / EXE_NAME).resolve():
        # First double-click of the downloaded .exe: install, start, tell the user.
        _install_and_launch()
        _popup("MindEase agent is installed and running.\n\n"
               "Now open the MindEase website and sign in.\n"
               "It will start automatically whenever you log in to Windows.")
    else:
        run_agent(args.interval_minutes)
