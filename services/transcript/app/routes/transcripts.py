from datetime import datetime, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from shared.auth import get_current_user
from shared.database import get_db
from shared.models import Transcript, TranscriptUtterance, Meeting

from ..models import (
    TranscriptResponse,
    TranscriptSearchRequest,
    TranscriptSearchResult,
    TranscriptUpdate,
    UtteranceResponse,
)

router = APIRouter(prefix="/transcripts", tags=["transcripts"])


@router.get("/meeting/{meeting_id}", response_model=TranscriptResponse)
async def get_transcript_for_meeting(
    meeting_id: UUID,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> TranscriptResponse:
    """Get the full transcript for a meeting, including all utterances."""
    result = await db.execute(
        select(Transcript)
        .where(Transcript.meeting_id == meeting_id)
        .options(selectinload(Transcript.utterances))
    )
    transcript = result.scalar_one_or_none()
    if transcript is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"No transcript found for meeting {meeting_id}",
        )
    return TranscriptResponse.model_validate(transcript)


@router.get("/meeting/{meeting_id}/utterances", response_model=list[UtteranceResponse])
async def get_utterances(
    meeting_id: UUID,
    speaker_index: int | None = Query(default=None, description="Filter by speaker index"),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[UtteranceResponse]:
    """Get utterances for a meeting with pagination and optional speaker filter."""
    # First, find the transcript for this meeting
    transcript_result = await db.execute(
        select(Transcript.id).where(Transcript.meeting_id == meeting_id)
    )
    transcript_id = transcript_result.scalar_one_or_none()
    if transcript_id is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"No transcript found for meeting {meeting_id}",
        )

    query = (
        select(TranscriptUtterance)
        .where(TranscriptUtterance.transcript_id == transcript_id)
        .order_by(TranscriptUtterance.start_time)
    )

    if speaker_index is not None:
        query = query.where(TranscriptUtterance.speaker_index == speaker_index)

    query = query.offset(offset).limit(limit)

    result = await db.execute(query)
    utterances = result.scalars().all()
    return [UtteranceResponse.model_validate(u) for u in utterances]


@router.post("/search", response_model=list[TranscriptSearchResult])
async def search_transcripts(
    body: TranscriptSearchRequest,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[TranscriptSearchResult]:
    """Full-text search across transcripts with optional project and date filters."""
    query = (
        select(
            TranscriptUtterance.id.label("utterance_id"),
            TranscriptUtterance.transcript_id,
            Meeting.id.label("meeting_id"),
            Meeting.title.label("meeting_title"),
            TranscriptUtterance.speaker_name,
            TranscriptUtterance.text,
            TranscriptUtterance.start_time,
            TranscriptUtterance.end_time,
            Meeting.created_at.label("meeting_date"),
        )
        .join(Transcript, TranscriptUtterance.transcript_id == Transcript.id)
        .join(Meeting, Transcript.meeting_id == Meeting.id)
        .where(TranscriptUtterance.text.ilike(f"%{body.query}%"))
    )

    if body.project_id is not None:
        query = query.where(Meeting.project_id == body.project_id)

    if body.date_from is not None:
        query = query.where(
            Meeting.created_at >= datetime.combine(body.date_from, datetime.min.time()).replace(tzinfo=timezone.utc)
        )

    if body.date_to is not None:
        query = query.where(
            Meeting.created_at <= datetime.combine(body.date_to, datetime.max.time()).replace(tzinfo=timezone.utc)
        )

    query = query.order_by(Meeting.created_at.desc()).offset(body.offset).limit(body.limit)

    result = await db.execute(query)
    rows = result.all()

    return [
        TranscriptSearchResult(
            utterance_id=row.utterance_id,
            transcript_id=row.transcript_id,
            meeting_id=row.meeting_id,
            meeting_title=row.meeting_title,
            speaker_name=row.speaker_name,
            text=row.text,
            start_time=row.start_time,
            end_time=row.end_time,
            meeting_date=row.meeting_date,
        )
        for row in rows
    ]


@router.put("/{transcript_id}", response_model=TranscriptResponse)
async def update_transcript(
    transcript_id: UUID,
    body: TranscriptUpdate,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> TranscriptResponse:
    """Update a transcript's text content."""
    result = await db.execute(
        select(Transcript)
        .where(Transcript.id == transcript_id)
        .options(selectinload(Transcript.utterances))
    )
    transcript = result.scalar_one_or_none()
    if transcript is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Transcript {transcript_id} not found",
        )

    if body.full_text is not None:
        transcript.full_text = body.full_text
        # Recalculate word count
        transcript.word_count = len(body.full_text.split())

    await db.flush()
    await db.refresh(transcript)
    return TranscriptResponse.model_validate(transcript)
