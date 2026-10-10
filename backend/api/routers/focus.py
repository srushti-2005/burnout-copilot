import logging
import re
import sys
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from core.config import SESSIONS_TABLE
from core.security import get_current_user_id
from core.supabase_client import get_service_client

BASE_DIR = Path(__file__).resolve().parent.parent.parent
if str(BASE_DIR) not in sys.path:
    sys.path.insert(0, str(BASE_DIR))

from src.data.supabase_manager import create_intervention
from services.digital_twin import SESSION_USER_COL, SESSION_TIME_COL, CLI_COL

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/focus", tags=["focus-protection"])

FOCUS_TABLE = "focus_sessions"
INTERVENTIONS_TABLE = "interventions"


# ── request models ──────────────────────────────────────────────────────────
class StartRequest(BaseModel):
    planned_duration_min: int = Field(20, ge=5, le=90)


class EndRequest(BaseModel):
    cancelled: bool = False
    # Focus Guard: how many times the user left this tab/window during the
    # session, counted client-side (Page Visibility + blur/focus). Purely
    # observational -- there is no way, and no reason, to prevent this at
    # the browser level; this closes the gap between "task switching" as
    # inferred by the tracker and what actually happened during a session
    # explicitly meant to prevent it.
    distraction_count: int = Field(0, ge=0)


class FeedbackRequest(BaseModel):
    rating: int = Field(..., ge=1, le=5)
    note: Optional[str] = Field(None, max_length=500)


# ── helpers ─────────────────────────────────────────────────────────────────
def _now() -> datetime:
    return datetime.now(timezone.utc)


def _parse(ts: str) -> datetime:
    """Parse a Postgres timestamptz, padding fractional seconds so it also works on Python < 3.11."""
    s = ts.replace("Z", "+00:00")
    m = re.match(r"^(.*?\.)(\d+)(.*)$", s)
    if m:
        s = m.group(1) + m.group(2)[:6].ljust(6, "0") + m.group(3)
    return datetime.fromisoformat(s)


def _num(v) -> Optional[float]:
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def _latest_session(client, user_id: str, after: Optional[datetime] = None) -> Optional[dict]:
    q = client.table(SESSIONS_TABLE).select("*").eq(SESSION_USER_COL, user_id)
    if after is not None:
        q = q.gt(SESSION_TIME_COL, after.isoformat())
    res = q.order(SESSION_TIME_COL, desc=True).limit(1).execute()
    return res.data[0] if res.data else None


def _snapshot(session: Optional[dict]) -> dict:
    """Behavioral state stored before/after a focus session. risk = CLI as a percentage."""
    if not session:
        return {"cli": None, "risk": None, "task_switching": None, "work_duration": None}
    cli = _num(session.get(CLI_COL))
    return {
        "cli": cli,
        "risk": round(cli * 100, 1) if cli is not None else None,
        "task_switching": _num(session.get("task_switching")),
        "work_duration": _num(session.get("work_duration")),
    }


def _get_owned(client, focus_id: str, user_id: str) -> dict:
    try:
        uuid.UUID(focus_id)
    except ValueError:
        raise HTTPException(status_code=404, detail="Focus session not found")
    res = (
        client.table(FOCUS_TABLE).select("*")
        .eq("id", focus_id).eq("user_id", user_id).limit(1).execute()
    )
    if not res.data:
        # Same answer for "missing" and "not yours", so ids can't be probed
        raise HTTPException(status_code=404, detail="Focus session not found")
    return res.data[0]


def _capture_after(client, row: dict) -> dict:
    """
    After-state = the first session the tracker recorded since the focus session started.
    If none exists yet, leave it empty. The result endpoint retries later.
    """
    if row.get("cli_after") is not None or row["status"] == "active":
        return row
    latest = _latest_session(client, row["user_id"], after=_parse(row["start_time"]))
    if not latest:
        return row
    snap = _snapshot(latest)
    update = {
        "cli_after": snap["cli"],
        "risk_after": snap["risk"],
        "task_switching_after": snap["task_switching"],
    }
    client.table(FOCUS_TABLE).update(update).eq("id", row["id"]).execute()
    return {**row, **update}


def _result_payload(row: dict) -> dict:
    before = {
        "risk": _num(row.get("risk_before")),
        "cli": _num(row.get("cli_before")),
        "task_switching": _num(row.get("task_switching_before")),
    }
    after = None
    if row.get("cli_after") is not None:
        after = {
            "risk": _num(row.get("risk_after")),
            "cli": _num(row.get("cli_after")),
            "task_switching": _num(row.get("task_switching_after")),
        }

    comparison = None
    if after:
        def delta(k: str) -> Optional[float]:
            b, a = before.get(k), after.get(k)
            return None if b is None or a is None else round(a - b, 1)

        risk_change = delta("risk")
        comparison = {
            "risk_change": risk_change,
            "task_switching_change": delta("task_switching"),
            "improved": risk_change is not None and risk_change < 0,
        }

        return {
        "session_id": row["id"],
        "status": row["status"],
        "planned_duration_min": row["planned_duration_min"],
        "start_time": row["start_time"],
        "end_time": row.get("end_time"),
        "before": before,
        "after": after,
        "comparison": comparison,
        "rating": row.get("rating"),
        "distraction_count": row.get("distraction_count", 0) or 0,
    }


# ── feedback-loop integration (spec step 11) ────────────────────────────────
def _create_linked_intervention(user_id: str, before: dict, session_id: Optional[str]) -> Optional[str]:
    """Registers the focus session as a tracked intervention. Non-fatal on failure."""
    try:
        row = create_intervention(
            uid=user_id,
            intervention_type="focus_protection",
            session_id=session_id,
            before_state={
                "cli_before": before["cli"],
                "risk_before": before["risk"],
                "task_switching_before": before["task_switching"],
                "work_duration_before": before["work_duration"],
            },
        )
        return row.get("id") if row else None
    except Exception:
        logger.exception("Could not create linked intervention for user %s (non-fatal)", user_id)
        return None


def _sync_intervention(client, row: dict, feedback: Optional[str] = None) -> None:
    """Mirrors outcome + feedback onto the linked interventions row. Non-fatal on failure."""
    iid = row.get("intervention_id")
    if not iid:
        return
    update: dict = {}
    if row["status"] != "active":
        update["completed"] = row["status"] == "completed"
        update["resolved_at"] = row.get("end_time") or _now().isoformat()
    if row.get("cli_after") is not None:
        update["cli_after"] = row.get("cli_after")
        update["risk_after"] = row.get("risk_after")
        update["task_switching_after"] = row.get("task_switching_after")
    if feedback is not None:
        update["user_feedback"] = feedback
    if not update:
        return
    try:
        (
            client.table(INTERVENTIONS_TABLE).update(update)
            .eq("id", iid).eq("user_id", row["user_id"]).execute()
        )
    except Exception:
        logger.exception("Could not sync focus outcome to intervention %s (non-fatal)", iid)


# ── endpoints ───────────────────────────────────────────────────────────────
@router.post("/start")
def start_focus(body: StartRequest, user_id: str = Depends(get_current_user_id)):
    client = get_service_client()

    active = (
        client.table(FOCUS_TABLE).select("id")
        .eq("user_id", user_id).eq("status", "active").limit(1).execute()
    )
    if active.data:
        raise HTTPException(status_code=409, detail="A focus session is already active")

    before_session = _latest_session(client, user_id)
    before = _snapshot(before_session)

    row = {
        "user_id": user_id,
        "status": "active",
        "start_time": _now().isoformat(),
        "planned_duration_min": body.planned_duration_min,
        "risk_before": before["risk"],
        "cli_before": before["cli"],
        "task_switching_before": before["task_switching"],
    }
    try:
        created = client.table(FOCUS_TABLE).insert(row).execute()
    except Exception as e:
        msg = str(e).lower()
        if "23505" in msg or "duplicate" in msg:
            raise HTTPException(status_code=409, detail="A focus session is already active")
        logger.exception("Focus session insert failed for user %s", user_id)
        raise HTTPException(status_code=502, detail="Could not start focus session, please try again")

    saved = created.data[0]

    iid = _create_linked_intervention(
        user_id, before, before_session["id"] if before_session else None
    )
    if iid:
        try:
            client.table(FOCUS_TABLE).update({"intervention_id": iid}).eq("id", saved["id"]).execute()
            saved["intervention_id"] = iid
        except Exception:
            logger.exception("Could not link intervention to focus session (non-fatal)")

    return {"session": saved, "remaining_seconds": body.planned_duration_min * 60}


@router.get("/active")
def get_active_focus(user_id: str = Depends(get_current_user_id)):
    """Lets the UI resume a running session after a page reload."""
    client = get_service_client()
    res = (
        client.table(FOCUS_TABLE).select("*")
        .eq("user_id", user_id).eq("status", "active").limit(1).execute()
    )
    if not res.data:
        return {"session": None, "remaining_seconds": 0}

    row = res.data[0]
    ends_at = _parse(row["start_time"]) + timedelta(minutes=row["planned_duration_min"])
    remaining = max(0, int((ends_at - _now()).total_seconds()))
    return {"session": row, "remaining_seconds": remaining}


@router.post("/{focus_id}/end")
def end_focus(focus_id: str, body: EndRequest, user_id: str = Depends(get_current_user_id)):
    client = get_service_client()
    row = _get_owned(client, focus_id, user_id)

    if row["status"] == "active":
        update = {
            "status": "cancelled" if body.cancelled else "completed",
            "end_time": _now().isoformat(),
            "distraction_count": body.distraction_count,
        }
    client.table(FOCUS_TABLE).update(update).eq("id", focus_id).execute()
    row = {**row, **update}

    row = _capture_after(client, row)
    _sync_intervention(client, row)
    return _result_payload(row)


@router.get("/{focus_id}/result")
def focus_result(focus_id: str, user_id: str = Depends(get_current_user_id)):
    client = get_service_client()
    row = _get_owned(client, focus_id, user_id)
    row = _capture_after(client, row)
    _sync_intervention(client, row)
    return _result_payload(row)


@router.post("/{focus_id}/feedback")
def focus_feedback(focus_id: str, body: FeedbackRequest, user_id: str = Depends(get_current_user_id)):
    client = get_service_client()
    row = _get_owned(client, focus_id, user_id)

    if row["status"] == "active":
        raise HTTPException(status_code=409, detail="End the focus session before giving feedback")

    update = {"rating": body.rating, "feedback_note": body.note}
    client.table(FOCUS_TABLE).update(update).eq("id", focus_id).execute()
    row = {**row, **update}

    text = f"rating {body.rating}/5" + (f": {body.note}" if body.note else "")
    _sync_intervention(client, row, feedback=text)
    return _result_payload(row)
