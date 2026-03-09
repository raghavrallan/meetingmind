from datetime import datetime, timedelta, timezone
from urllib.parse import urlencode
from uuid import UUID

import bcrypt
import httpx
from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from shared.auth import create_access_token, get_current_user, verify_token
from shared.config import get_settings
from shared.credits import SIGNUP_BONUS
from shared.database import get_db
from shared.models import User
from shared.models.credit_transaction import CreditTransaction

from ..models import (
    DeviceLoginRequest,
    LoginEmailRequest,
    OAuthCallbackRequest,
    SignupRequest,
    TokenResponse,
    UserResponse,
)

router = APIRouter(prefix="/auth", tags=["auth"])
settings = get_settings()

ACCESS_TOKEN_MAX_AGE = settings.jwt_expiration_minutes * 60
REFRESH_TOKEN_MAX_AGE = settings.refresh_token_expire_days * 86400


# ── Password helpers ─────────────────────────────────────────────────

def _hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()


def _verify_password(password: str, hashed: str) -> bool:
    return bcrypt.checkpw(password.encode(), hashed.encode())


# ── Cookie helpers ───────────────────────────────────────────────────

def _set_auth_cookies(response: Response, user: User) -> str:
    access_token = create_access_token(
        user_id=user.id,
        email=user.email,
        is_admin=user.is_admin,
        expires_delta=timedelta(minutes=settings.jwt_expiration_minutes),
    )
    refresh_token = create_access_token(
        user_id=user.id,
        email=user.email,
        is_admin=user.is_admin,
        expires_delta=timedelta(days=settings.refresh_token_expire_days),
    )

    cookie_kwargs = {
        "httponly": True,
        "samesite": "lax",
        "secure": settings.cookie_secure,
        "path": "/",
    }
    if settings.cookie_domain:
        cookie_kwargs["domain"] = settings.cookie_domain

    response.set_cookie(
        key="access_token",
        value=access_token,
        max_age=ACCESS_TOKEN_MAX_AGE,
        **cookie_kwargs,
    )
    response.set_cookie(
        key="refresh_token",
        value=refresh_token,
        max_age=REFRESH_TOKEN_MAX_AGE,
        **cookie_kwargs,
    )

    return access_token


def _clear_auth_cookies(response: Response) -> None:
    cookie_kwargs = {"path": "/", "httponly": True, "samesite": "lax"}
    if settings.cookie_domain:
        cookie_kwargs["domain"] = settings.cookie_domain
    response.delete_cookie(key="access_token", **cookie_kwargs)
    response.delete_cookie(key="refresh_token", **cookie_kwargs)


# ── Google OAuth ─────────────────────────────────────────────────────

GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
GOOGLE_USERINFO_URL = "https://www.googleapis.com/oauth2/v2/userinfo"


async def _exchange_google_code(code: str, redirect_uri: str) -> dict:
    async with httpx.AsyncClient() as client:
        token_resp = await client.post(
            GOOGLE_TOKEN_URL,
            data={
                "code": code,
                "client_id": settings.google_client_id,
                "client_secret": settings.google_client_secret,
                "redirect_uri": redirect_uri,
                "grant_type": "authorization_code",
            },
        )
        if token_resp.status_code != 200:
            raise HTTPException(status_code=401, detail=f"Google token exchange failed: {token_resp.text}")
        token_data = token_resp.json()

        userinfo_resp = await client.get(
            GOOGLE_USERINFO_URL,
            headers={"Authorization": f"Bearer {token_data['access_token']}"},
        )
        if userinfo_resp.status_code != 200:
            raise HTTPException(status_code=401, detail="Failed to fetch Google user info")
        userinfo = userinfo_resp.json()

    return {
        "provider": "google",
        "provider_id": userinfo["id"],
        "email": userinfo["email"],
        "name": userinfo.get("name", userinfo["email"]),
        "avatar_url": userinfo.get("picture"),
        "access_token": token_data["access_token"],
        "refresh_token": token_data.get("refresh_token"),
        "expires_in": token_data.get("expires_in", 3600),
    }


# ── Microsoft OAuth ──────────────────────────────────────────────────

MICROSOFT_TOKEN_URL = "https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token"
MICROSOFT_USERINFO_URL = "https://graph.microsoft.com/v1.0/me"


async def _exchange_microsoft_code(code: str, redirect_uri: str) -> dict:
    token_url = MICROSOFT_TOKEN_URL.format(tenant=settings.microsoft_tenant_id)
    async with httpx.AsyncClient() as client:
        token_resp = await client.post(
            token_url,
            data={
                "code": code,
                "client_id": settings.microsoft_client_id,
                "client_secret": settings.microsoft_client_secret,
                "redirect_uri": redirect_uri,
                "grant_type": "authorization_code",
                "scope": "openid profile email User.Read Calendars.Read",
            },
        )
        if token_resp.status_code != 200:
            raise HTTPException(status_code=401, detail=f"Microsoft token exchange failed: {token_resp.text}")
        token_data = token_resp.json()

        userinfo_resp = await client.get(
            MICROSOFT_USERINFO_URL,
            headers={"Authorization": f"Bearer {token_data['access_token']}"},
        )
        if userinfo_resp.status_code != 200:
            raise HTTPException(status_code=401, detail="Failed to fetch Microsoft user info")
        userinfo = userinfo_resp.json()

    return {
        "provider": "microsoft",
        "provider_id": userinfo["id"],
        "email": userinfo.get("mail") or userinfo.get("userPrincipalName", ""),
        "name": userinfo.get("displayName", ""),
        "avatar_url": None,
        "access_token": token_data["access_token"],
        "refresh_token": token_data.get("refresh_token"),
        "expires_in": token_data.get("expires_in", 3600),
    }


# ── User upsert for OAuth ───────────────────────────────────────────

async def _upsert_oauth_user(db: AsyncSession, oauth_data: dict) -> User:
    # Check if user exists by email first (may have signed up with email/password)
    result = await db.execute(select(User).where(User.email == oauth_data["email"]))
    user = result.scalar_one_or_none()

    now = datetime.now(timezone.utc)
    expires_at = datetime.fromtimestamp(now.timestamp() + oauth_data["expires_in"], tz=timezone.utc)

    is_new_user = user is None
    if is_new_user:
        user = User(
            email=oauth_data["email"],
            name=oauth_data["name"],
            avatar_url=oauth_data["avatar_url"],
            auth_provider=oauth_data["provider"],
            provider_id=oauth_data["provider_id"],
            access_token=oauth_data["access_token"],
            refresh_token=oauth_data["refresh_token"],
            token_expires_at=expires_at,
            email_verified=True,
            credit_balance=SIGNUP_BONUS,
            lifetime_credits=SIGNUP_BONUS,
        )
        db.add(user)
    else:
        user.name = oauth_data["name"] or user.name
        user.avatar_url = oauth_data["avatar_url"] or user.avatar_url
        user.auth_provider = oauth_data["provider"]
        user.provider_id = oauth_data["provider_id"]
        user.access_token = oauth_data["access_token"]
        if oauth_data["refresh_token"]:
            user.refresh_token = oauth_data["refresh_token"]
        user.token_expires_at = expires_at
        user.email_verified = True
        user.updated_at = now

    await db.flush()
    await db.refresh(user)

    if is_new_user:
        tx = CreditTransaction(
            user_id=user.id,
            amount=SIGNUP_BONUS,
            balance_after=SIGNUP_BONUS,
            type="signup_bonus",
            description=f"Welcome bonus: {SIGNUP_BONUS} credits",
        )
        db.add(tx)
        await db.flush()

    return user


# ── Routes ───────────────────────────────────────────────────────────


@router.post("/signup")
async def signup(
    body: SignupRequest,
    response: Response,
    db: AsyncSession = Depends(get_db),
):
    """Register a new user with email and password."""
    existing = await db.execute(select(User).where(User.email == body.email))
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=409, detail="An account with this email already exists")

    user = User(
        email=body.email,
        name=body.name,
        password_hash=_hash_password(body.password),
        auth_provider="email",
        email_verified=False,
        credit_balance=SIGNUP_BONUS,
        lifetime_credits=SIGNUP_BONUS,
    )
    db.add(user)
    await db.flush()
    await db.refresh(user)

    # Log the signup bonus credit transaction
    tx = CreditTransaction(
        user_id=user.id,
        amount=SIGNUP_BONUS,
        balance_after=SIGNUP_BONUS,
        type="signup_bonus",
        description=f"Welcome bonus: {SIGNUP_BONUS} credits",
    )
    db.add(tx)

    access_token = _set_auth_cookies(response, user)

    return {
        "access_token": access_token,
        "user": UserResponse.model_validate(user),
    }


@router.post("/login")
async def login_email(
    body: LoginEmailRequest,
    response: Response,
    db: AsyncSession = Depends(get_db),
):
    """Login with email and password. Sets HTTP-only auth cookies."""
    result = await db.execute(select(User).where(User.email == body.email))
    user = result.scalar_one_or_none()

    if not user or not user.password_hash:
        raise HTTPException(status_code=401, detail="Invalid email or password")

    try:
        if not _verify_password(body.password, user.password_hash):
            raise HTTPException(status_code=401, detail="Invalid email or password")
    except ValueError:
        raise HTTPException(status_code=401, detail="Invalid email or password")

    if user.status == "deleted":
        raise HTTPException(status_code=401, detail="Account not found")
    if user.status == "suspended":
        reason = user.suspended_reason or "Contact support for more information"
        raise HTTPException(status_code=403, detail=f"Account suspended: {reason}")

    access_token = _set_auth_cookies(response, user)

    return {
        "access_token": access_token,
        "user": UserResponse.model_validate(user),
    }


@router.post("/logout")
async def logout(response: Response):
    """Clear auth cookies."""
    _clear_auth_cookies(response)
    return {"message": "Logged out"}


@router.post("/refresh")
async def refresh_token(
    request: Request,
    response: Response,
    db: AsyncSession = Depends(get_db),
):
    """Refresh access token using the refresh cookie."""
    token = request.cookies.get("refresh_token")
    if not token:
        raise HTTPException(status_code=401, detail="No refresh token")

    try:
        payload = verify_token(token)
    except HTTPException:
        _clear_auth_cookies(response)
        raise HTTPException(status_code=401, detail="Invalid refresh token")

    user_id = UUID(payload["sub"])
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user or user.status == "deleted":
        _clear_auth_cookies(response)
        raise HTTPException(status_code=401, detail="User not found")
    if user.status == "suspended":
        _clear_auth_cookies(response)
        reason = user.suspended_reason or "Contact support for more information"
        raise HTTPException(status_code=403, detail=f"Account suspended: {reason}")

    _set_auth_cookies(response, user)
    return {"user": UserResponse.model_validate(user)}


@router.get("/me", response_model=UserResponse)
async def get_me(
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> UserResponse:
    """Get the currently authenticated user."""
    user_id = UUID(current_user["sub"])
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")
    return UserResponse.model_validate(user)


# ── OAuth redirect endpoints (server-side redirect flow) ─────────────


@router.get("/oauth/google")
async def google_oauth_redirect(
    redirect_uri: str = Query(default=""),
):
    """Redirect user to Google OAuth consent screen."""
    if not settings.google_client_id:
        raise HTTPException(status_code=400, detail="Google OAuth not configured")
    callback_url = redirect_uri or f"{settings.frontend_url}/auth/callback/google"
    params = {
        "client_id": settings.google_client_id,
        "redirect_uri": callback_url,
        "response_type": "code",
        "scope": "openid email profile https://www.googleapis.com/auth/calendar.readonly",
        "access_type": "offline",
        "prompt": "consent",
    }
    return {"url": f"https://accounts.google.com/o/oauth2/v2/auth?{urlencode(params)}"}


@router.post("/oauth/google/callback")
async def google_oauth_callback(
    body: OAuthCallbackRequest,
    response: Response,
    db: AsyncSession = Depends(get_db),
):
    """Exchange Google auth code for tokens, create/update user, set cookies."""
    oauth_data = await _exchange_google_code(body.code, body.redirect_uri)
    user = await _upsert_oauth_user(db, oauth_data)
    access_token = _set_auth_cookies(response, user)
    return {"access_token": access_token, "user": UserResponse.model_validate(user)}


@router.get("/oauth/microsoft")
async def microsoft_oauth_redirect(
    redirect_uri: str = Query(default=""),
):
    """Redirect user to Microsoft OAuth consent screen."""
    if not settings.microsoft_client_id:
        raise HTTPException(status_code=400, detail="Microsoft OAuth not configured")
    callback_url = redirect_uri or f"{settings.frontend_url}/auth/callback/microsoft"
    tenant = settings.microsoft_tenant_id or "common"
    params = {
        "client_id": settings.microsoft_client_id,
        "redirect_uri": callback_url,
        "response_type": "code",
        "scope": "openid profile email User.Read Calendars.Read",
        "response_mode": "query",
    }
    return {"url": f"https://login.microsoftonline.com/{tenant}/oauth2/v2.0/authorize?{urlencode(params)}"}


@router.post("/oauth/microsoft/callback")
async def microsoft_oauth_callback(
    body: OAuthCallbackRequest,
    response: Response,
    db: AsyncSession = Depends(get_db),
):
    """Exchange Microsoft auth code for tokens, create/update user, set cookies."""
    oauth_data = await _exchange_microsoft_code(body.code, body.redirect_uri)
    user = await _upsert_oauth_user(db, oauth_data)
    access_token = _set_auth_cookies(response, user)
    return {"access_token": access_token, "user": UserResponse.model_validate(user)}


# ── Legacy: Device login (for Electron desktop app) ─────────────────


@router.post("/device-login", response_model=TokenResponse)
async def device_login(
    body: DeviceLoginRequest,
    db: AsyncSession = Depends(get_db),
) -> TokenResponse:
    """Login for the Electron desktop agent. Returns JWT in body (not cookies)."""
    device_email = "agent@local.device"
    result = await db.execute(
        select(User).where(User.auth_provider == "device", User.email == device_email)
    )
    user = result.scalar_one_or_none()

    if user is None:
        user = User(
            email=device_email,
            name=body.device_name,
            auth_provider="device",
            provider_id="local-device",
        )
        db.add(user)
        await db.flush()
        await db.refresh(user)

    jwt_token = create_access_token(user_id=user.id, email=user.email, is_admin=user.is_admin)
    return TokenResponse(
        access_token=jwt_token,
        token_type="bearer",
        expires_in=settings.jwt_expiration_minutes * 60,
        user=UserResponse.model_validate(user),
    )
