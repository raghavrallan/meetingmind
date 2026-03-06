from datetime import datetime, timezone
from typing import Optional
from uuid import UUID

from celery import Celery
from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import StreamingResponse
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from shared.auth import get_current_user
from shared.config import get_settings
from shared.database import get_db
from shared.models import Meeting, MeetingParticipant
from shared.models.meeting import MeetingStatus

from ..audio_storage import download_audio
from ..models import MeetingCreate, MeetingListResponse, MeetingResponse, MeetingUpdate

router = APIRouter(prefix="/meetings", tags=["meetings"])
settings = get_settings()

# Celery client for enqueuing async tasks
celery_app = Celery(broker=settings.celery_broker_url, backend=settings.celery_result_backend)


# ── Helpers ─────────────────────────────────────────────────────────────


async def _get_meeting_or_404(
    meeting_id: UUID,
    db: AsyncSession,
    user_id: UUID,
) -> Meeting:
    """Fetch a meeting by ID or raise 404. Verifies ownership."""
    result = await db.execute(
        select(Meeting)
        .options(selectinload(Meeting.participants))
        .where(Meeting.id == meeting_id)
    )
    meeting = result.scalar_one_or_none()
    if meeting is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Meeting not found",
        )
    if meeting.created_by_id != user_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You do not have access to this meeting",
        )
    return meeting


# ── Routes ──────────────────────────────────────────────────────────────


@router.post("/", response_model=MeetingResponse, status_code=status.HTTP_201_CREATED)
async def create_meeting(
    body: MeetingCreate,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> MeetingResponse:
    """Create a new meeting."""
    user_id = UUID(current_user["sub"])

    meeting = Meeting(
        title=body.title,
        project_id=body.project_id,
        created_by_id=user_id,
        language=body.language,
        scheduled_start=body.scheduled_start,
        scheduled_end=body.scheduled_end,
        calendar_event_id=body.calendar_event_id,
        calendar_provider=body.calendar_provider,
        status=MeetingStatus.SCHEDULED,
    )
    db.add(meeting)
    await db.flush()
    await db.refresh(meeting, attribute_names=["participants"])
    return MeetingResponse.model_validate(meeting)


@router.get("/", response_model=MeetingListResponse)
async def list_meetings(
    project_id: Optional[UUID] = Query(None, description="Filter by project ID"),
    page: int = Query(1, ge=1, description="Page number"),
    per_page: int = Query(20, ge=1, le=100, description="Items per page"),
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> MeetingListResponse:
    """List meetings with optional project filter and pagination."""
    user_id = UUID(current_user["sub"])

    # Base query
    base_query = select(Meeting).where(Meeting.created_by_id == user_id)
    count_query = select(func.count()).select_from(Meeting).where(Meeting.created_by_id == user_id)

    if project_id is not None:
        base_query = base_query.where(Meeting.project_id == project_id)
        count_query = count_query.where(Meeting.project_id == project_id)

    # Get total count
    total_result = await db.execute(count_query)
    total = total_result.scalar() or 0

    # Get paginated results
    offset = (page - 1) * per_page
    result = await db.execute(
        base_query
        .options(selectinload(Meeting.participants))
        .order_by(Meeting.created_at.desc())
        .offset(offset)
        .limit(per_page)
    )
    meetings = result.scalars().all()

    return MeetingListResponse(
        meetings=[MeetingResponse.model_validate(m) for m in meetings],
        total=total,
        page=page,
        per_page=per_page,
    )


@router.get("/{meeting_id}", response_model=MeetingResponse)
async def get_meeting(
    meeting_id: UUID,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> MeetingResponse:
    """Get a meeting by ID."""
    user_id = UUID(current_user["sub"])
    meeting = await _get_meeting_or_404(meeting_id, db, user_id)
    return MeetingResponse.model_validate(meeting)


@router.patch("/{meeting_id}", response_model=MeetingResponse)
async def update_meeting(
    meeting_id: UUID,
    body: MeetingUpdate,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> MeetingResponse:
    """Update a meeting's details."""
    user_id = UUID(current_user["sub"])
    meeting = await _get_meeting_or_404(meeting_id, db, user_id)

    update_data = body.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(meeting, field, value)

    meeting.updated_at = datetime.now(timezone.utc)
    await db.flush()
    await db.refresh(meeting, attribute_names=["participants"])
    return MeetingResponse.model_validate(meeting)


@router.delete("/{meeting_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_meeting(
    meeting_id: UUID,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> None:
    """Delete a meeting."""
    user_id = UUID(current_user["sub"])
    meeting = await _get_meeting_or_404(meeting_id, db, user_id)
    await db.delete(meeting)
    await db.flush()


@router.post("/{meeting_id}/start", response_model=MeetingResponse)
async def start_recording(
    meeting_id: UUID,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> MeetingResponse:
    """Start recording a meeting. Sets status to 'recording'."""
    user_id = UUID(current_user["sub"])
    meeting = await _get_meeting_or_404(meeting_id, db, user_id)

    if meeting.status not in (MeetingStatus.SCHEDULED,):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Cannot start recording: meeting is in '{meeting.status.value}' state",
        )

    meeting.status = MeetingStatus.RECORDING
    meeting.actual_start = datetime.now(timezone.utc)
    meeting.updated_at = datetime.now(timezone.utc)
    await db.flush()
    await db.refresh(meeting, attribute_names=["participants"])
    return MeetingResponse.model_validate(meeting)


@router.post("/{meeting_id}/stop", response_model=MeetingResponse)
async def stop_recording(
    meeting_id: UUID,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> MeetingResponse:
    """Stop recording a meeting. Sets status to 'processing' and enqueues Celery tasks."""
    user_id = UUID(current_user["sub"])
    meeting = await _get_meeting_or_404(meeting_id, db, user_id)

    if meeting.status != MeetingStatus.RECORDING:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Cannot stop recording: meeting is in '{meeting.status.value}' state",
        )

    meeting.status = MeetingStatus.PROCESSING
    meeting.actual_end = datetime.now(timezone.utc)

    # Calculate duration
    if meeting.actual_start:
        delta = meeting.actual_end - meeting.actual_start
        meeting.duration_seconds = delta.total_seconds()

    meeting.updated_at = datetime.now(timezone.utc)
    await db.flush()
    await db.refresh(meeting, attribute_names=["participants"])

    # Enqueue Celery tasks for AI processing
    meeting_id_str = str(meeting.id)
    celery_app.send_task(
        "ai_worker.generate_meeting_notes",
        args=[meeting_id_str],
        queue="ai",
    )

    return MeetingResponse.model_validate(meeting)


@router.get("/{meeting_id}/audio")
async def get_meeting_audio(
    meeting_id: UUID,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Stream the recorded audio for a meeting from MinIO."""
    user_id = UUID(current_user["sub"])
    meeting = await _get_meeting_or_404(meeting_id, db, user_id)

    if not meeting.audio_storage_key:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No audio recording available for this meeting",
        )

    try:
        audio_data = await download_audio(meeting.audio_storage_key)
    except Exception:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Audio file not found in storage",
        )

    import io
    return StreamingResponse(
        io.BytesIO(audio_data),
        media_type="audio/wav",
        headers={
            "Content-Disposition": f'inline; filename="meeting-{meeting_id}.wav"',
            "Content-Length": str(len(audio_data)),
        },
    )
