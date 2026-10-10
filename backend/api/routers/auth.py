# api/routers/auth.py
import os
import sys
import json
from pathlib import Path
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, EmailStr, Field

from core.supabase_client import get_auth_client
from core.security import get_current_user_id

BASE_DIR = Path(__file__).resolve().parent.parent.parent
if str(BASE_DIR) not in sys.path:
    sys.path.insert(0, str(BASE_DIR))

from src.data.supabase_manager import upsert_profile_age, get_profile, update_profile as db_update_profile

router = APIRouter(prefix="/auth", tags=["auth"])

# Same file startup_logger.py watches (both live at the project root).
CREDS_FILE = BASE_DIR / ".burnout_local_creds.json"
_LOCAL_HOSTS = {"127.0.0.1", "::1", "localhost"}


def _publish_active_user(request: Request, uid: str | None, email: str | None) -> None:
    """
    Tell the background logger who is signed in. Only when the login request
    comes from this same machine (so a phone or remote login never changes
    what THIS computer's keyboard logger records).
    Set DISABLE_LOGGER_SWITCH=1 to turn this off.
    """
    if os.getenv("DISABLE_LOGGER_SWITCH") == "1" or not uid or not email:
        return
    host = request.client.host if request.client else ""
    if host not in _LOCAL_HOSTS:
        return
    try:
        tmp = CREDS_FILE.with_suffix(".tmp")
        tmp.write_text(json.dumps({"uid": uid, "email": email}), encoding="utf-8")
        os.replace(tmp, CREDS_FILE)
    except Exception as e:
        print(f"[auth] could not publish active user: {e}")


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class SignupRequest(BaseModel):
    email: EmailStr
    password: str
    name: str
    age: int = Field(..., ge=13, le=100)


class ResetRequest(BaseModel):
    email: EmailStr


class AuthResult(BaseModel):
    success: bool
    uid: str | None = None
    email: str | None = None
    display_name: str | None = None
    access_token: str | None = None   # Supabase JWT, sent as "Authorization: Bearer <token>"
    error: str | None = None


class ProfileOut(BaseModel):
    id: str
    email: EmailStr
    display_name: str
    age: int | None = None


class ProfileUpdateRequest(BaseModel):
    display_name: str | None = None
    age: int | None = Field(None, ge=13, le=100)


def _token_of(res) -> str | None:
    session = getattr(res, "session", None)
    return session.access_token if session else None


@router.post("/login", response_model=AuthResult)
def login(payload: LoginRequest, request: Request):
    try:
        client = get_auth_client()
        res = client.auth.sign_in_with_password(
            {"email": payload.email, "password": payload.password}
        )
        if not res.user:
            return AuthResult(success=False, error="Invalid email or password")
        meta = res.user.user_metadata or {}
        _publish_active_user(request, res.user.id, res.user.email)
        return AuthResult(
            success=True,
            uid=res.user.id,
            email=res.user.email,
            display_name=meta.get("display_name") or meta.get("name") or "",
            access_token=_token_of(res),
        )
    except Exception as e:
        return AuthResult(success=False, error=str(e))


@router.post("/signup", response_model=AuthResult)
def signup(payload: SignupRequest, request: Request):
    try:
        client = get_auth_client()
        res = client.auth.sign_up(
            {
                "email": payload.email,
                "password": payload.password,
                "options": {"data": {"display_name": payload.name, "age": payload.age}},
            }
        )
        if not res.user:
            return AuthResult(success=False, error="Signup failed")

        upsert_profile_age(res.user.id, res.user.email, payload.name, payload.age)

        token = _token_of(res)
        if token:  # only a real signed-in session becomes the tracked user
            _publish_active_user(request, res.user.id, res.user.email)

        return AuthResult(
            success=True,
            uid=res.user.id,
            email=res.user.email,
            display_name=payload.name,
            # None when Supabase requires email confirmation: the UI then asks the user to log in
            access_token=token,
        )
    except Exception as e:
        return AuthResult(success=False, error=str(e))


@router.post("/logout")
def logout(user_id: str = Depends(get_current_user_id)):
    """
    Stops local tracking if (and only if) the signing-out user is the one
    currently being tracked. Call this from your sign-out button.
    """
    try:
        data = json.loads(CREDS_FILE.read_text(encoding="utf-8"))
        if data.get("uid") == user_id:
            CREDS_FILE.unlink(missing_ok=True)
    except FileNotFoundError:
        pass
    except Exception as e:
        print(f"[auth] logout cleanup failed: {e}")
    return {"success": True}


@router.post("/reset", response_model=AuthResult)
def reset(payload: ResetRequest):
    try:
        get_auth_client().auth.reset_password_email(payload.email)
        return AuthResult(success=True, email=payload.email)
    except Exception as e:
        return AuthResult(success=False, error=str(e))


@router.get("/profile", response_model=ProfileOut)
def read_profile(user_id: str = Depends(get_current_user_id)):
    """
    No uid path param on purpose: user_id comes ONLY from the verified
    token via get_current_user_id, so there is nothing to spoof.
    """
    profile = get_profile(user_id)
    if not profile:
        raise HTTPException(status_code=404, detail="Profile not found")
    return ProfileOut(**profile)


@router.patch("/profile", response_model=ProfileOut)
def patch_profile(payload: ProfileUpdateRequest, user_id: str = Depends(get_current_user_id)):
    fields = payload.model_dump(exclude_unset=True)
    if fields:
        db_update_profile(user_id, fields)
    profile = get_profile(user_id)
    if not profile:
        raise HTTPException(status_code=404, detail="Profile not found")
    return ProfileOut(**profile)