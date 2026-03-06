from datetime import datetime, timezone
from typing import Optional
from uuid import UUID

import httpx
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from shared.auth import get_current_user
from shared.config import get_settings
from shared.database import get_db
from shared.models import User

router = APIRouter(prefix="/calendar", tags=["calendar"])
settings = get_settings()

# ── Response models ─────────────────────────────────────────────────────


class CalendarEvent(BaseModel):
    id: str
    title: str
    start: datetime
    end: datetime
    organizer: Optional[str] = None
    attendees: list[str] = []
    meeting_link: Optional[str] = None
    provider: str


class CalendarEventsResponse(BaseModel):
    events: list[CalendarEvent]
    synced_at: datetime


class CalendarSyncResponse(BaseModel):
    status: str
    events_synced: int
    synced_at: datetime


# ── Helper: get user with valid OAuth token ─────────────────────────────


async def _get_user_with_token(user_id: UUID, db: AsyncSession) -> User:
    """Fetch user and ensure they have a valid OAuth access token."""
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found",
        )
    if not user.access_token:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No calendar access token. Please re-authenticate with calendar permissions.",
        )
    return user


# ── Helper: refresh expired OAuth tokens ────────────────────────────────


async def _refresh_google_token(user: User, db: AsyncSession) -> str:
    """Refresh an expired Google access token using the refresh token."""
    if not user.refresh_token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="No refresh token available. Please re-authenticate.",
        )
    async with httpx.AsyncClient() as client:
        resp = await client.post(
            "https://oauth2.googleapis.com/token",
            data={
                "client_id": settings.google_client_id,
                "client_secret": settings.google_client_secret,
                "refresh_token": user.refresh_token,
                "grant_type": "refresh_token",
            },
        )
        if resp.status_code != 200:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Failed to refresh Google token. Please re-authenticate.",
            )
        token_data = resp.json()

    user.access_token = token_data["access_token"]
    expires_in = token_data.get("expires_in", 3600)
    user.token_expires_at = datetime.fromtimestamp(
        datetime.now(timezone.utc).timestamp() + expires_in, tz=timezone.utc
    )
    await db.flush()
    return user.access_token


async def _refresh_microsoft_token(user: User, db: AsyncSession) -> str:
    """Refresh an expired Microsoft access token using the refresh token."""
    if not user.refresh_token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="No refresh token available. Please re-authenticate.",
        )
    token_url = f"https://login.microsoftonline.com/{settings.microsoft_tenant_id}/oauth2/v2.0/token"
    async with httpx.AsyncClient() as client:
        resp = await client.post(
            token_url,
            data={
                "client_id": settings.microsoft_client_id,
                "client_secret": settings.microsoft_client_secret,
                "refresh_token": user.refresh_token,
                "grant_type": "refresh_token",
                "scope": "openid profile email User.Read Calendars.Read",
            },
        )
        if resp.status_code != 200:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Failed to refresh Microsoft token. Please re-authenticate.",
            )
        token_data = resp.json()

    user.access_token = token_data["access_token"]
    if token_data.get("refresh_token"):
        user.refresh_token = token_data["refresh_token"]
    expires_in = token_data.get("expires_in", 3600)
    user.token_expires_at = datetime.fromtimestamp(
        datetime.now(timezone.utc).timestamp() + expires_in, tz=timezone.utc
    )
    await db.flush()
    return user.access_token


async def _ensure_valid_token(user: User, db: AsyncSession) -> str:
    """Ensure the user has a non-expired access token, refreshing if needed."""
    now = datetime.now(timezone.utc)
    if user.token_expires_at and user.token_expires_at > now:
        return user.access_token

    if user.auth_provider == "google":
        return await _refresh_google_token(user, db)
    elif user.auth_provider == "microsoft":
        return await _refresh_microsoft_token(user, db)
    else:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Unsupported auth provider: {user.auth_provider}",
        )


# ── Google Calendar ─────────────────────────────────────────────────────

GOOGLE_CALENDAR_EVENTS_URL = "https://www.googleapis.com/calendar/v3/calendars/primary/events"


async def _fetch_google_events(access_token: str) -> list[CalendarEvent]:
    """Fetch upcoming events from Google Calendar API."""
    now = datetime.now(timezone.utc).isoformat()
    async with httpx.AsyncClient() as client:
        resp = await client.get(
            GOOGLE_CALENDAR_EVENTS_URL,
            headers={"Authorization": f"Bearer {access_token}"},
            params={
                "timeMin": now,
                "maxResults": 50,
                "singleEvents": "true",
                "orderBy": "startTime",
            },
        )
        if resp.status_code != 200:
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail=f"Google Calendar API error: {resp.text}",
            )
        data = resp.json()

    events: list[CalendarEvent] = []
    for item in data.get("items", []):
        start_str = item.get("start", {}).get("dateTime") or item.get("start", {}).get("date")
        end_str = item.get("end", {}).get("dateTime") or item.get("end", {}).get("date")
        if not start_str or not end_str:
            continue

        # Extract meeting link from conferenceData
        meeting_link = None
        conference_data = item.get("conferenceData", {})
        for entry_point in conference_data.get("entryPoints", []):
            if entry_point.get("entryPointType") == "video":
                meeting_link = entry_point.get("uri")
                break

        attendees = [
            a.get("email", "") for a in item.get("attendees", []) if a.get("email")
        ]

        events.append(
            CalendarEvent(
                id=item["id"],
                title=item.get("summary", "Untitled"),
                start=datetime.fromisoformat(start_str),
                end=datetime.fromisoformat(end_str),
                organizer=item.get("organizer", {}).get("email"),
                attendees=attendees,
                meeting_link=meeting_link,
                provider="google",
            )
        )
    return events


# ── Microsoft Calendar ──────────────────────────────────────────────────

MICROSOFT_CALENDAR_EVENTS_URL = "https://graph.microsoft.com/v1.0/me/calendarview"


async def _fetch_microsoft_events(access_token: str) -> list[CalendarEvent]:
    """Fetch upcoming events from Microsoft Graph Calendar API."""
    now = datetime.now(timezone.utc)
    # Fetch events for the next 7 days
    end_time = datetime.fromtimestamp(now.timestamp() + 7 * 86400, tz=timezone.utc)

    async with httpx.AsyncClient() as client:
        resp = await client.get(
            MICROSOFT_CALENDAR_EVENTS_URL,
            headers={
                "Authorization": f"Bearer {access_token}",
                "Prefer": 'outlook.timezone="UTC"',
            },
            params={
                "startDateTime": now.isoformat(),
                "endDateTime": end_time.isoformat(),
                "$top": 50,
                "$orderby": "start/dateTime",
            },
        )
        if resp.status_code != 200:
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail=f"Microsoft Calendar API error: {resp.text}",
            )
        data = resp.json()

    events: list[CalendarEvent] = []
    for item in data.get("value", []):
        start_str = item.get("start", {}).get("dateTime", "")
        end_str = item.get("end", {}).get("dateTime", "")
        if not start_str or not end_str:
            continue

        # Microsoft Graph returns datetimes without timezone, but we set UTC via Prefer header
        if not start_str.endswith("Z") and "+" not in start_str:
            start_str += "Z"
        if not end_str.endswith("Z") and "+" not in end_str:
            end_str += "Z"

        # Extract online meeting link
        meeting_link = item.get("onlineMeeting", {}).get("joinUrl") if item.get("onlineMeeting") else None

        attendees = [
            a.get("emailAddress", {}).get("address", "")
            for a in item.get("attendees", [])
            if a.get("emailAddress", {}).get("address")
        ]

        events.append(
            CalendarEvent(
                id=item["id"],
                title=item.get("subject", "Untitled"),
                start=datetime.fromisoformat(start_str),
                end=datetime.fromisoformat(end_str),
                organizer=item.get("organizer", {}).get("emailAddress", {}).get("address"),
                attendees=attendees,
                meeting_link=meeting_link,
                provider="microsoft",
            )
        )
    return events


# ── Routes ──────────────────────────────────────────────────────────────


@router.get("/events", response_model=CalendarEventsResponse)
async def list_calendar_events(
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> CalendarEventsResponse:
    """List upcoming calendar events from the user's connected calendar."""
    user_id = UUID(current_user["sub"])
    user = await _get_user_with_token(user_id, db)
    access_token = await _ensure_valid_token(user, db)

    if user.auth_provider == "google":
        events = await _fetch_google_events(access_token)
    elif user.auth_provider == "microsoft":
        events = await _fetch_microsoft_events(access_token)
    else:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Calendar not supported for provider: {user.auth_provider}",
        )

    return CalendarEventsResponse(
        events=events,
        synced_at=datetime.now(timezone.utc),
    )


@router.post("/sync", response_model=CalendarSyncResponse)
async def sync_calendar(
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> CalendarSyncResponse:
    """Trigger a calendar sync to refresh events."""
    user_id = UUID(current_user["sub"])
    user = await _get_user_with_token(user_id, db)
    access_token = await _ensure_valid_token(user, db)

    if user.auth_provider == "google":
        events = await _fetch_google_events(access_token)
    elif user.auth_provider == "microsoft":
        events = await _fetch_microsoft_events(access_token)
    else:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Calendar not supported for provider: {user.auth_provider}",
        )

    return CalendarSyncResponse(
        status="synced",
        events_synced=len(events),
        synced_at=datetime.now(timezone.utc),
    )
