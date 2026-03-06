import os
import asyncio
from datetime import datetime, timezone, timedelta

import httpx
from celery_app import app
from sqlalchemy import select
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession

from shared.models import User, Meeting
from shared.models.meeting import MeetingStatus

DATABASE_URL = os.getenv("DATABASE_URL", "postgresql+asyncpg://notetaker:notetaker_secret@postgres:5432/ai_notetaker")
GOOGLE_CLIENT_ID = os.getenv("GOOGLE_CLIENT_ID", "")
GOOGLE_CLIENT_SECRET = os.getenv("GOOGLE_CLIENT_SECRET", "")
MICROSOFT_CLIENT_ID = os.getenv("MICROSOFT_CLIENT_ID", "")
MICROSOFT_CLIENT_SECRET = os.getenv("MICROSOFT_CLIENT_SECRET", "")

engine = create_async_engine(DATABASE_URL, pool_size=5)
async_session = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


async def _refresh_google_token(user: User) -> str | None:
    if not user.refresh_token or user.auth_provider != "google":
        return None
    async with httpx.AsyncClient() as client:
        resp = await client.post("https://oauth2.googleapis.com/token", data={
            "client_id": GOOGLE_CLIENT_ID,
            "client_secret": GOOGLE_CLIENT_SECRET,
            "refresh_token": user.refresh_token,
            "grant_type": "refresh_token",
        })
        if resp.status_code == 200:
            data = resp.json()
            return data.get("access_token")
    return None


async def _refresh_microsoft_token(user: User) -> str | None:
    if not user.refresh_token or user.auth_provider != "microsoft":
        return None
    tenant_id = os.getenv("MICROSOFT_TENANT_ID", "common")
    async with httpx.AsyncClient() as client:
        resp = await client.post(
            f"https://login.microsoftonline.com/{tenant_id}/oauth2/v2.0/token",
            data={
                "client_id": MICROSOFT_CLIENT_ID,
                "client_secret": MICROSOFT_CLIENT_SECRET,
                "refresh_token": user.refresh_token,
                "grant_type": "refresh_token",
                "scope": "https://graph.microsoft.com/.default",
            },
        )
        if resp.status_code == 200:
            data = resp.json()
            return data.get("access_token")
    return None


async def _sync_google_calendar(session: AsyncSession, user: User, access_token: str):
    now = datetime.now(timezone.utc)
    time_min = now.isoformat()
    time_max = (now + timedelta(days=7)).isoformat()

    async with httpx.AsyncClient() as client:
        resp = await client.get(
            "https://www.googleapis.com/calendar/v3/calendars/primary/events",
            headers={"Authorization": f"Bearer {access_token}"},
            params={
                "timeMin": time_min,
                "timeMax": time_max,
                "singleEvents": "true",
                "orderBy": "startTime",
                "maxResults": 50,
            },
        )
        if resp.status_code != 200:
            return

        events = resp.json().get("items", [])
        for event in events:
            event_id = event.get("id")
            # Check if meeting already exists for this event
            result = await session.execute(
                select(Meeting).where(
                    Meeting.calendar_event_id == event_id,
                    Meeting.created_by_id == user.id,
                )
            )
            existing = result.scalar_one_or_none()
            if existing:
                continue

            start = event.get("start", {})
            end = event.get("end", {})
            start_dt = start.get("dateTime")
            end_dt = end.get("dateTime")

            if start_dt:
                meeting = Meeting(
                    title=event.get("summary", "Untitled Meeting"),
                    status=MeetingStatus.SCHEDULED,
                    created_by_id=user.id,
                    calendar_event_id=event_id,
                    calendar_provider="google",
                    scheduled_start=datetime.fromisoformat(start_dt),
                    scheduled_end=datetime.fromisoformat(end_dt) if end_dt else None,
                )
                session.add(meeting)

        await session.commit()


async def _sync_microsoft_calendar(session: AsyncSession, user: User, access_token: str):
    now = datetime.now(timezone.utc)
    time_max = now + timedelta(days=7)

    async with httpx.AsyncClient() as client:
        resp = await client.get(
            "https://graph.microsoft.com/v1.0/me/calendarview",
            headers={"Authorization": f"Bearer {access_token}"},
            params={
                "startDateTime": now.isoformat(),
                "endDateTime": time_max.isoformat(),
                "$top": 50,
                "$orderby": "start/dateTime",
            },
        )
        if resp.status_code != 200:
            return

        events = resp.json().get("value", [])
        for event in events:
            event_id = event.get("id")
            result = await session.execute(
                select(Meeting).where(
                    Meeting.calendar_event_id == event_id,
                    Meeting.created_by_id == user.id,
                )
            )
            existing = result.scalar_one_or_none()
            if existing:
                continue

            start = event.get("start", {})
            end = event.get("end", {})
            start_dt = start.get("dateTime")
            end_dt = end.get("dateTime")

            if start_dt:
                meeting = Meeting(
                    title=event.get("subject", "Untitled Meeting"),
                    status=MeetingStatus.SCHEDULED,
                    created_by_id=user.id,
                    calendar_event_id=event_id,
                    calendar_provider="microsoft",
                    scheduled_start=datetime.fromisoformat(start_dt),
                    scheduled_end=datetime.fromisoformat(end_dt) if end_dt else None,
                )
                session.add(meeting)

        await session.commit()


async def _sync_all():
    async with async_session() as session:
        result = await session.execute(
            select(User).where(User.is_active == True, User.refresh_token.isnot(None))
        )
        users = result.scalars().all()

        for user in users:
            try:
                if user.auth_provider == "google":
                    token = await _refresh_google_token(user)
                    if token:
                        await _sync_google_calendar(session, user, token)
                elif user.auth_provider == "microsoft":
                    token = await _refresh_microsoft_token(user)
                    if token:
                        await _sync_microsoft_calendar(session, user, token)
            except Exception as e:
                print(f"Calendar sync failed for user {user.id}: {e}")
                continue


@app.task(name="calendar_worker.sync_all_calendars")
def sync_all_calendars():
    asyncio.run(_sync_all())
    return {"status": "completed"}


@app.task(name="calendar_worker.sync_user_calendar")
def sync_user_calendar(user_id: str):
    async def _sync_user():
        async with async_session() as session:
            from uuid import UUID
            user = await session.get(User, UUID(user_id))
            if not user or not user.refresh_token:
                return

            if user.auth_provider == "google":
                token = await _refresh_google_token(user)
                if token:
                    await _sync_google_calendar(session, user, token)
            elif user.auth_provider == "microsoft":
                token = await _refresh_microsoft_token(user)
                if token:
                    await _sync_microsoft_calendar(session, user, token)

    asyncio.run(_sync_user())
    return {"status": "completed", "user_id": user_id}
