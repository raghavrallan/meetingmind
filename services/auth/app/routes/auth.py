from datetime import datetime, timezone
from urllib.parse import urlencode
from uuid import UUID

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from shared.auth import create_access_token, get_current_user
from shared.config import get_settings
from shared.database import get_db
from shared.models import User

from ..models import DeviceLoginRequest, LoginRequest, OAuthCallbackRequest, TokenResponse, UserResponse

router = APIRouter(prefix="/auth", tags=["auth"])
settings = get_settings()

# ── Google OAuth endpoints ──────────────────────────────────────────────

GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
GOOGLE_USERINFO_URL = "https://www.googleapis.com/oauth2/v2/userinfo"


async def _exchange_google_code(code: str, redirect_uri: str) -> dict:
    """Exchange Google authorization code for tokens and user info."""
    async with httpx.AsyncClient() as client:
        # Exchange code for tokens
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
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail=f"Google token exchange failed: {token_resp.text}",
            )
        token_data = token_resp.json()

        # Fetch user info
        userinfo_resp = await client.get(
            GOOGLE_USERINFO_URL,
            headers={"Authorization": f"Bearer {token_data['access_token']}"},
        )
        if userinfo_resp.status_code != 200:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Failed to fetch Google user info",
            )
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


# ── Microsoft OAuth endpoints ──────────────────────────────────────────

MICROSOFT_TOKEN_URL = "https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token"
MICROSOFT_USERINFO_URL = "https://graph.microsoft.com/v1.0/me"


async def _exchange_microsoft_code(code: str, redirect_uri: str) -> dict:
    """Exchange Microsoft authorization code for tokens and user info."""
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
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail=f"Microsoft token exchange failed: {token_resp.text}",
            )
        token_data = token_resp.json()

        userinfo_resp = await client.get(
            MICROSOFT_USERINFO_URL,
            headers={"Authorization": f"Bearer {token_data['access_token']}"},
        )
        if userinfo_resp.status_code != 200:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Failed to fetch Microsoft user info",
            )
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


# ── Upsert user helper ─────────────────────────────────────────────────


async def _upsert_user(db: AsyncSession, oauth_data: dict) -> User:
    """Create or update a user from OAuth data."""
    result = await db.execute(
        select(User).where(
            User.auth_provider == oauth_data["provider"],
            User.provider_id == oauth_data["provider_id"],
        )
    )
    user = result.scalar_one_or_none()

    now = datetime.now(timezone.utc)
    expires_at = datetime.fromtimestamp(
        now.timestamp() + oauth_data["expires_in"], tz=timezone.utc
    )

    if user is None:
        user = User(
            email=oauth_data["email"],
            name=oauth_data["name"],
            avatar_url=oauth_data["avatar_url"],
            auth_provider=oauth_data["provider"],
            provider_id=oauth_data["provider_id"],
            access_token=oauth_data["access_token"],
            refresh_token=oauth_data["refresh_token"],
            token_expires_at=expires_at,
        )
        db.add(user)
    else:
        user.email = oauth_data["email"]
        user.name = oauth_data["name"]
        user.avatar_url = oauth_data["avatar_url"] or user.avatar_url
        user.access_token = oauth_data["access_token"]
        if oauth_data["refresh_token"]:
            user.refresh_token = oauth_data["refresh_token"]
        user.token_expires_at = expires_at
        user.updated_at = now

    await db.flush()
    await db.refresh(user)
    return user


def _build_token_response(user: User) -> TokenResponse:
    """Build JWT token response from a user record."""
    jwt_token = create_access_token(user_id=user.id, email=user.email)
    return TokenResponse(
        access_token=jwt_token,
        token_type="bearer",
        expires_in=settings.jwt_expiration_minutes * 60,
        user=UserResponse.model_validate(user),
    )


# ── Routes ──────────────────────────────────────────────────────────────


@router.get("/oauth/google/url")
async def google_oauth_url(
    redirect_uri: str = Query(..., description="Frontend callback URL"),
) -> dict:
    """Return the Google OAuth consent URL for the frontend to redirect to."""
    if not settings.google_client_id:
        raise HTTPException(status_code=400, detail="Google OAuth not configured. Set google_client_id first.")
    params = {
        "client_id": settings.google_client_id,
        "redirect_uri": redirect_uri,
        "response_type": "code",
        "scope": "openid email profile https://www.googleapis.com/auth/calendar.readonly",
        "access_type": "offline",
        "prompt": "consent",
    }
    return {"url": f"https://accounts.google.com/o/oauth2/v2/auth?{urlencode(params)}"}


@router.get("/oauth/microsoft/url")
async def microsoft_oauth_url(
    redirect_uri: str = Query(..., description="Frontend callback URL"),
) -> dict:
    """Return the Microsoft OAuth consent URL for the frontend to redirect to."""
    if not settings.microsoft_client_id:
        raise HTTPException(status_code=400, detail="Microsoft OAuth not configured. Set microsoft_client_id first.")
    tenant = settings.microsoft_tenant_id or "common"
    params = {
        "client_id": settings.microsoft_client_id,
        "redirect_uri": redirect_uri,
        "response_type": "code",
        "scope": "openid profile email User.Read Calendars.Read",
        "response_mode": "query",
    }
    return {"url": f"https://login.microsoftonline.com/{tenant}/oauth2/v2.0/authorize?{urlencode(params)}"}


@router.post("/login/google", response_model=TokenResponse)
async def login_google(
    body: OAuthCallbackRequest,
    db: AsyncSession = Depends(get_db),
) -> TokenResponse:
    """Google OAuth callback: exchange code, create/update user, return JWT."""
    oauth_data = await _exchange_google_code(body.code, body.redirect_uri)
    user = await _upsert_user(db, oauth_data)
    return _build_token_response(user)


@router.post("/login/microsoft", response_model=TokenResponse)
async def login_microsoft(
    body: OAuthCallbackRequest,
    db: AsyncSession = Depends(get_db),
) -> TokenResponse:
    """Microsoft OAuth callback: exchange code, create/update user, return JWT."""
    oauth_data = await _exchange_microsoft_code(body.code, body.redirect_uri)
    user = await _upsert_user(db, oauth_data)
    return _build_token_response(user)


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
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found",
        )
    return UserResponse.model_validate(user)


@router.post("/refresh", response_model=TokenResponse)
async def refresh_token(
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> TokenResponse:
    """Refresh the JWT token for the current user."""
    user_id = UUID(current_user["sub"])
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found",
        )
    return _build_token_response(user)


@router.post("/device-login", response_model=TokenResponse)
async def device_login(
    body: DeviceLoginRequest,
    db: AsyncSession = Depends(get_db),
) -> TokenResponse:
    """
    Login for the Electron desktop agent.
    Creates or retrieves a local device user (no OAuth required) and returns a JWT.
    """
    device_email = "agent@local.device"

    result = await db.execute(
        select(User).where(
            User.auth_provider == "device",
            User.email == device_email,
        )
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

    return _build_token_response(user)
