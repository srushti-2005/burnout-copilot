"""
MindEase PC agent.

Runs on a tester's own Windows PC. It:
  1. listens on 127.0.0.1 for the MindEase website (allow-listed origins, full CORS/PNA),
  2. receives user login tokens from the website or direct sign-in,
  3. starts the existing tracker (tracker.py) for that user,
  4. uploads each finished session to the deployed API (POST /sessions) with the
     USER'S token. The API works out the user from the token, so a session can
     only ever be saved under the account that is signed in.
  5. registers the mindease:// protocol for 1-click token handoff from browsers,
  6. provides an optional companion GUI when launched directly by the user.

Typing is recorded as counts per minute only (never which keys).
"""
from __future__ import annotations

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
import webbrowser
from pathlib import Path
from logging.handlers import RotatingFileHandler
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib import request as urlrequest, error as urlerror
from urllib.parse import urlparse, parse_qs

# ───────────────────────── CONFIG ─────────────────────────
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

PORT = 47821
VERSION = "1.0.1"
DEFAULT_INTERVAL_MINUTES = 2.0   # 2 minutes for rapid verification; override with --interval-minutes 60
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

# tracker.py (bundled with the agent or loaded from backend)
_backend_dir = Path(__file__).resolve().parent.parent / "backend"
if str(_backend_dir) not in sys.path:
    sys.path.insert(0, str(_backend_dir))

try:
    import tracker  # type: ignore
except ImportError:
    try:
        from src.data import tracker  # type: ignore
    except ImportError:
        tracker = None  # type: ignore



# ───────────────────────── small helpers ─────────────────────────
def _popup(text: str, title: str = "MindEase") -> None:
    try:
        import ctypes
        threading.Thread(
            target=lambda: ctypes.windll.user32.MessageBoxW(0, text, title, 0x40),
            daemon=True
        ).start()
    except Exception:
        print(text)


def _jwt_payload(token: str) -> dict:
    try:
        parts = token.split(".")
        if len(parts) < 2:
            return {}
        part = parts[1]
        part += "=" * (-len(part) % 4)
        return json.loads(base64.urlsafe_b64decode(part))
    except Exception:
        return {}


def _jwt_exp(token: str) -> int:
    return int(_jwt_payload(token).get("exp", 0))


def _http(method: str, path: str, body=None, token: str | None = None, timeout: int = 15):
    """Returns (status, parsed_json_or_None)."""
    data = json.dumps(body).encode("utf-8") if body is not None else None
    url = (API_URL + path) if path.startswith("/") else path
    req = urlrequest.Request(url, data=data, method=method)
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
    os.replace(tmp, STATE_FILE)


def _stop_tracking() -> None:
    try:
        if tracker.is_running():
            tracker.stop_tracker()
            t = getattr(tracker, "_tracker_thread", None)
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
    """Swap the refresh token for fresh tokens via the API or directly via Supabase Auth."""
    rt = _state.get("refresh_token")
    if not rt:
        return

    # 1. Try backend API /auth/refresh
    status, out = _http("POST", "/auth/refresh", {"refresh_token": rt}, timeout=10)
    if status == 200 and out and out.get("success") and out.get("access_token"):
        _state["access_token"] = out["access_token"]
        if out.get("refresh_token"):
            _state["refresh_token"] = out["refresh_token"]
        _save_state()
        return

    # 2. Direct Supabase Auth token refresh
    try:
        url = f"{SUPABASE_URL}/auth/v1/token?grant_type=refresh_token"
        req = urlrequest.Request(
            url,
            data=json.dumps({"refresh_token": rt}).encode("utf-8"),
            headers={"Content-Type": "application/json", "apikey": SUPABASE_ANON_KEY},
            method="POST",
        )
        with urlrequest.urlopen(req, timeout=12) as r:
            data = json.loads(r.read())
            if data.get("access_token"):
                _state["access_token"] = data["access_token"]
                if data.get("refresh_token"):
                    _state["refresh_token"] = data["refresh_token"]
                _save_state()
                log.info("Refreshed tokens directly with Supabase Auth")
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
    """Replacement for supabase_manager.save_session. Saves session via FastAPI API."""
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

    # Up to 3 attempts with brief backoff in case Render is spinning up
    last_status = 0
    for attempt in range(1, 4):
        try:
            status, out = _http("POST", "/sessions", payload, token=_get_token(), timeout=20)
            if status == 401:
                status, out = _http("POST", "/sessions", payload, token=_get_token(force=True), timeout=20)
            if status == 200 and isinstance(out, dict):
                log.info(f"Session saved successfully: id={out.get('id')} cli={out.get('cli_score')}")
                return out
            last_status = status
            if status >= 500 or status == 0:
                time.sleep(2)
        except Exception as e:
            log.warning(f"Session save attempt {attempt} error: {e}")
            time.sleep(2)

    raise RuntimeError(f"API returned {last_status} while saving session")


def ensure_tracking() -> None:
    with _lock:
        uid = _state.get("uid")
    if uid and not tracker.is_running():
        tracker.set_saver(save_via_api)
        tracker.start_tracker(uid)
        log.info(f"tracking started for {_state.get('email')}")


def apply_login(access_token: str, refresh_token: str | None = None) -> dict:
    """Instantly parse claims from JWT, save state, and start tracking without blocking network calls."""
    payload = _jwt_payload(access_token)
    uid = payload.get("sub")
    email = payload.get("email") or payload.get("user_metadata", {}).get("email")

    if not uid:
        # Fallback to API profile lookup if claims not in JWT
        status, out = _http("GET", "/auth/profile", token=access_token, timeout=5)
        if status == 200 and isinstance(out, dict) and out.get("id"):
            uid = out["id"]
            email = out.get("email")

    if not uid:
        raise ValueError("could not decode user identity from token")

    with _lock:
        changed = _state.get("uid") != uid
        if changed:
            _stop_tracking()
        _state.clear()
        _state["uid"] = uid
        _state["email"] = email or "user"
        _state["access_token"] = access_token
        if refresh_token:
            _state["refresh_token"] = refresh_token
        _save_state()

    ensure_tracking()
    log.info(f"Signed in as {email or uid}; tracking active")
    return {"email": email or "", "uid": uid, "tracking": True}


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

    def log_message(self, *args):
        pass

    def _host_ok(self) -> bool:
        host = self.headers.get("Host", "").lower().split(":")[0]
        return host in {"127.0.0.1", "localhost", "::1"}

    def _origin(self) -> str:
        o = (self.headers.get("Origin") or "").rstrip("/")
        if not o:
            return "*"
        if o in ALLOWED_ORIGINS:
            return o
        try:
            p = urlparse(o)
            host = (p.hostname or "").lower()
            if host in ("localhost", "127.0.0.1") or host.endswith(".vercel.app") or host.endswith(".onrender.com"):
                return o
        except Exception:
            pass
        return o or "*"

    def _send(self, code: int, obj=None, origin: str | None = None):
        body = b"" if obj is None else json.dumps(obj).encode("utf-8")
        try:
            self.send_response(code)
            allowed = origin or self._origin()
            self.send_header("Access-Control-Allow-Origin", allowed)
            self.send_header("Vary", "Origin")
            self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Requested-With")
            self.send_header("Access-Control-Allow-Private-Network", "true")
            self.send_header("Access-Control-Max-Age", "86400")
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            if body:
                self.wfile.write(body)
        except Exception:
            pass

    def do_OPTIONS(self):
        if not self._host_ok():
            return self._send(403, {"error": "forbidden"})
        self._send(204, None, self._origin())

    def do_GET(self):
        if not self._host_ok():
            return self._send(403, {"error": "forbidden"})
        path = self.path.split("?")[0]
        origin = self._origin()
        if path == "/status":
            with _lock:
                email = _state.get("email")
                uid = _state.get("uid")
            return self._send(200, {
                "ok": True,
                "version": VERSION,
                "uid": uid,
                "email": email,
                "tracking": tracker.is_running(),
                "interval_minutes": tracker.INTERVAL_HOURS * 60.0,
            }, origin)
        if path == "/metrics":
            return self._send(200, {
                "key_events": len(getattr(tracker, "_key_times", [])),
                "switches": getattr(tracker, "_switch_count", 0),
                "total_switches": getattr(tracker, "_total_switches", getattr(tracker, "_switch_count", 0)),
                "last_window": getattr(tracker, "_last_window", ""),
                "running": tracker.is_running(),
            }, origin)
        self._send(404, {"error": "not found"}, origin)

    def do_POST(self):
        if not self._host_ok():
            return self._send(403, {"error": "forbidden"})
        path = self.path.split("?")[0]
        origin = self._origin()
        try:
            n = int(self.headers.get("Content-Length") or 0)
            if n > 32_768:
                return self._send(413, {"error": "too large"}, origin)
            body = json.loads(self.rfile.read(n) or b"{}")
        except Exception:
            return self._send(400, {"error": "bad request"}, origin)

        if path == "/login":
            at = body.get("access_token")
            rt = body.get("refresh_token")
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


def create_server(interval_minutes: float) -> AgentServer | None:
    if hasattr(tracker, "_attach_to_default_desktop"):
        tracker._attach_to_default_desktop()
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
        log.info("port already in use: another agent is running")
        return None

    _load_state()
    try:
        ensure_tracking()
    except Exception as e:
        log.error(f"could not resume tracking: {e}")

    threading.Thread(target=_watchdog, name="agent_watchdog", daemon=True).start()
    log.info(f"agent v{VERSION} listening on 127.0.0.1:{PORT}; API={API_URL}; "
             f"interval={interval_minutes} min; origins={sorted(ALLOWED_ORIGINS)}")
    return server


def start_server_in_thread(interval_minutes: float) -> AgentServer | None:
    server = create_server(interval_minutes)
    if not server:
        return None
    t = threading.Thread(target=server.serve_forever, name="agent_server", daemon=True)
    t.start()
    return server


def run_agent(interval_minutes: float) -> None:
    log.info("run_agent starting create_server...")
    server = create_server(interval_minutes)
    if not server:
        log.warning("run_agent: server could not be created; exiting")
        return
    try:
        log.info("run_agent entering serve_forever...")
        server.serve_forever()
        log.info("run_agent serve_forever returned normally")
    except (KeyboardInterrupt, SystemExit):
        log.info("run_agent received interrupt/exit")
    except Exception as e:
        log.exception(f"run_agent serve_forever crashed: {e}")
    finally:
        log.info("run_agent exiting and stopping tracking")
        _stop_tracking()


# ───────────────────────── install / protocol handler ─────────────────────────
def _register_protocol() -> None:
    if sys.platform != "win32":
        return
    try:
        import winreg
        target = APP_DIR / EXE_NAME
        exe_path = str(target) if getattr(sys, "frozen", False) else sys.executable
        cmd = f'"{exe_path}" "%1"'
        with winreg.CreateKey(winreg.HKEY_CURRENT_USER, r"Software\Classes\mindease") as k:
            winreg.SetValueEx(k, "", 0, winreg.REG_SZ, "URL:MindEase Protocol")
            winreg.SetValueEx(k, "URL Protocol", 0, winreg.REG_SZ, "")
            with winreg.CreateKey(k, r"shell\open\command") as cmd_k:
                winreg.SetValueEx(cmd_k, "", 0, winreg.REG_SZ, cmd)
    except Exception as e:
        log.warning(f"Could not register protocol handler: {e}")


def _handle_protocol_arg(arg: str) -> bool:
    if not arg.startswith("mindease://"):
        return False
    try:
        parsed = urlparse(arg)
        query = parsed.query or (parsed.netloc.split("?", 1)[-1] if "?" in parsed.netloc else "")
        qs = parse_qs(query)
        token = qs.get("token", [""])[0]
        refresh = qs.get("refresh", [""])[0]
        if token:
            try:
                req = urlrequest.Request(
                    f"http://127.0.0.1:{PORT}/login",
                    data=json.dumps({"access_token": token, "refresh_token": refresh}).encode("utf-8"),
                    headers={"Content-Type": "application/json", "Origin": "http://localhost:3000"},
                    method="POST",
                )
                with urlrequest.urlopen(req, timeout=3):
                    pass
                log.info("Handed tokens to running agent via localhost")
                _popup("MindEase Companion connected successfully!\nBackground tracking is active.")
                return True
            except Exception:
                apply_login(token, refresh)
                _popup(f"MindEase Companion connected!\nTracking active for {_state.get('email')}.")
                return True
    except Exception as e:
        log.error(f"Failed to handle protocol arg: {e}")
    return False


def _install_and_launch() -> None:
    import winreg
    target = APP_DIR / EXE_NAME
    if getattr(sys, "frozen", False):
        if Path(sys.executable).resolve() != target.resolve():
            _kill_other_agents()
            shutil.copy2(sys.executable, target)
        cmd = f'"{target}" --background'
        launch = [str(target), "--background"]
    else:
        pyw = Path(sys.executable.replace("python.exe", "pythonw.exe"))
        cmd = f'"{pyw}" "{Path(__file__).resolve()}" --background'
        launch = [str(pyw), str(Path(__file__).resolve()), "--background"]

    with winreg.CreateKey(winreg.HKEY_CURRENT_USER, RUN_KEY) as k:
        winreg.SetValueEx(k, RUN_VALUE, 0, winreg.REG_SZ, cmd)

    _register_protocol()

    flags = 0x08000000  # CREATE_NO_WINDOW (keep process attached to interactive desktop WinSta0\Default)
    subprocess.Popen(launch, creationflags=flags, close_fds=True)
    log.info(f"installed to {target if getattr(sys, 'frozen', False) else 'script mode'}")


def _kill_other_agents() -> None:
    try:
        import psutil
        curr_pid = os.getpid()
        ppid = psutil.Process(curr_pid).ppid()
        for p in psutil.process_iter(["pid", "name"]):
            try:
                if p.info["name"] == EXE_NAME and p.info["pid"] not in (curr_pid, ppid):
                    p.kill()
            except Exception:
                pass
        time.sleep(0.5)
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
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, r"Software\Classes", 0, winreg.KEY_SET_VALUE) as k:
            winreg.DeleteKey(k, r"mindease\shell\open\command")
            winreg.DeleteKey(k, r"mindease\shell\open")
            winreg.DeleteKey(k, r"mindease\shell")
            winreg.DeleteKey(k, "mindease")
    except Exception:
        pass
    try:
        STATE_FILE.unlink(missing_ok=True)
    except Exception:
        pass
    _kill_other_agents()
    _popup("MindEase agent removed. Tracking has stopped.\n"
           f"You can now delete the folder:\n{APP_DIR}")


# ───────────────────────── Companion GUI ─────────────────────────
def show_companion_gui():
    try:
        import tkinter as tk
        from tkinter import ttk, messagebox
    except ImportError:
        _popup(f"MindEase Companion is running.\nUser: {_state.get('email', 'Not signed in')}\nTracking: {tracker.is_running()}")
        return

    root = tk.Tk()
    root.title("MindEase — Digital Wellness Companion")
    root.geometry("450x380")
    root.resizable(False, False)

    header_frame = tk.Frame(root, bg="#6366f1", height=70)
    header_frame.pack(fill=tk.X)
    title_label = tk.Label(header_frame, text="MindEase Digital Wellness", font=("Segoe UI", 14, "bold"), fg="white", bg="#6366f1")
    title_label.pack(pady=(12, 2))
    sub_label = tk.Label(header_frame, text="PC Behavioral Tracker for Digital Burnout Prevention", font=("Segoe UI", 9), fg="#e0e7ff", bg="#6366f1")
    sub_label.pack(pady=(0, 10))

    content = tk.Frame(root, padx=24, pady=16)
    content.pack(fill=tk.BOTH, expand=True)

    status_var = tk.StringVar()
    email_var = tk.StringVar()

    def update_labels():
        _load_state()
        email = _state.get("email")
        running = tracker.is_running()
        if email and running:
            status_var.set("● Background Tracking: ACTIVE")
            email_var.set(f"Account: {email}")
        elif email:
            status_var.set("○ Background Tracking: IDLE")
            email_var.set(f"Account: {email}")
        else:
            status_var.set("○ Tracker: Not Connected")
            email_var.set("No MindEase account linked yet.")

    update_labels()

    lbl_status = tk.Label(content, textvariable=status_var, font=("Segoe UI", 11, "bold"),
                          fg="#16a34a" if tracker.is_running() else "#dc2626")
    lbl_status.pack(anchor="w", pady=(0, 4))
    lbl_email = tk.Label(content, textvariable=email_var, font=("Segoe UI", 10), fg="#4b5563")
    lbl_email.pack(anchor="w", pady=(0, 15))

    def on_open_web():
        webbrowser.open("https://burnout-copilot.vercel.app")

    def on_sign_in_direct():
        login_win = tk.Toplevel(root)
        login_win.title("Direct Sign-In — MindEase")
        login_win.geometry("340x250")
        login_win.resizable(False, False)
        login_win.transient(root)
        login_win.grab_set()

        tk.Label(login_win, text="Sign in to your MindEase Account", font=("Segoe UI", 10, "bold")).pack(pady=(15, 10))
        f = tk.Frame(login_win, padx=20)
        f.pack(fill=tk.BOTH, expand=True)

        tk.Label(f, text="Email:").pack(anchor="w")
        e_entry = ttk.Entry(f, width=32)
        e_entry.pack(fill=tk.X, pady=(0, 8))
        e_entry.focus()

        tk.Label(f, text="Password:").pack(anchor="w")
        p_entry = ttk.Entry(f, width=32, show="•")
        p_entry.pack(fill=tk.X, pady=(0, 15))

        def do_auth():
            em = e_entry.get().strip()
            pw = p_entry.get().strip()
            if not em or not pw:
                messagebox.showerror("Error", "Please enter your email and password.", parent=login_win)
                return
            try:
                url = f"{SUPABASE_URL}/auth/v1/token?grant_type=password"
                req = urlrequest.Request(
                    url,
                    data=json.dumps({"email": em, "password": pw}).encode("utf-8"),
                    headers={"Content-Type": "application/json", "apikey": SUPABASE_ANON_KEY},
                    method="POST",
                )
                with urlrequest.urlopen(req, timeout=15) as r:
                    data = json.loads(r.read())
                    apply_login(data["access_token"], data.get("refresh_token"))
                    messagebox.showinfo("Success", f"Connected successfully as {em}!\nTracking is now active.", parent=login_win)
                    login_win.destroy()
                    update_labels()
                    lbl_status.config(fg="#16a34a" if tracker.is_running() else "#dc2626")
            except Exception as ex:
                messagebox.showerror("Sign-in Failed", f"Could not sign in: {ex}", parent=login_win)

        btn_go = ttk.Button(f, text="Sign In & Start Tracking", command=do_auth)
        btn_go.pack(fill=tk.X)

    def on_view_log():
        try:
            os.startfile(LOG_FILE)
        except Exception:
            subprocess.Popen(["notepad.exe", str(LOG_FILE)])

    def on_sign_out():
        if messagebox.askyesno("Sign Out", "Stop tracking and sign out on this PC?", parent=root):
            apply_logout()
            update_labels()
            lbl_status.config(fg="#dc2626")

    btn_web = ttk.Button(content, text="🌐 Open MindEase Web Dashboard", command=on_open_web)
    btn_web.pack(fill=tk.X, pady=4)

    btn_direct = ttk.Button(content, text="🔑 Sign In to Account Directly", command=on_sign_in_direct)
    btn_direct.pack(fill=tk.X, pady=4)

    btn_log = ttk.Button(content, text="📄 View Live Activity Log", command=on_view_log)
    btn_log.pack(fill=tk.X, pady=4)

    btn_logout = ttk.Button(content, text="⏹ Sign Out / Stop Tracking", command=on_sign_out)
    btn_logout.pack(fill=tk.X, pady=4)

    root.mainloop()


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description="MindEase PC agent")
    ap.add_argument("--run", action="store_true", help="run in this process (development)")
    ap.add_argument("--background", action="store_true", help="run silently in background")
    ap.add_argument("--gui", action="store_true", help="show companion window")
    ap.add_argument("--uninstall", action="store_true")
    ap.add_argument("--interval-minutes", type=float,
                    default=float(os.environ.get("MINDEASE_INTERVAL_MINUTES", DEFAULT_INTERVAL_MINUTES)))
    args, unknown = ap.parse_known_args()

    # Check for mindease:// protocol invocation in positional arguments
    for u in unknown + sys.argv[1:]:
        if u.startswith("mindease://"):
            _handle_protocol_arg(u)
            sys.exit(0)

    if args.uninstall:
        _uninstall()
    elif args.run:
        run_agent(args.interval_minutes)
    elif args.background:
        run_agent(args.interval_minutes)
    elif sys.platform == "win32" and getattr(sys, "frozen", False) \
            and Path(sys.executable).resolve() != (APP_DIR / EXE_NAME).resolve():
        # First double-click of the downloaded .exe: install, register protocol, start background agent
        _install_and_launch()
        webbrowser.open("https://burnout-copilot.vercel.app")
        _popup("MindEase agent is installed and running.\n\n"
               "MindEase has opened in your browser.\n"
               "Once you sign in, tracking begins automatically.\n"
               "It will run in the background whenever you log in to Windows.")
    else:
        # Already installed or running directly: start background server thread and show companion GUI
        _register_protocol()
        start_server_in_thread(args.interval_minutes)
        show_companion_gui()
