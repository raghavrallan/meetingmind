from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from shared.auth import get_current_user
from shared.database import get_db
from shared.models import MeetingParticipant, Meeting, Transcript, TranscriptUtterance

from ..models import SpeakerResponse, SpeakerUpdate

router = APIRouter(prefix="/speakers", tags=["speakers"])


@router.get("/meeting/{meeting_id}", response_model=list[SpeakerResponse])
async def list_speakers(
    meeting_id: UUID,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[SpeakerResponse]:
    """List all speakers/participants for a meeting."""
    # Verify meeting exists
    meeting_result = await db.execute(
        select(Meeting).where(Meeting.id == meeting_id)
    )
    meeting = meeting_result.scalar_one_or_none()
    if meeting is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Meeting {meeting_id} not found",
        )

    result = await db.execute(
        select(MeetingParticipant)
        .where(MeetingParticipant.meeting_id == meeting_id)
        .order_by(MeetingParticipant.speaker_index)
    )
    participants = result.scalars().all()
    return [SpeakerResponse.model_validate(p) for p in participants]


@router.put("/{participant_id}", response_model=SpeakerResponse)
async def update_speaker(
    participant_id: UUID,
    body: SpeakerUpdate,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> SpeakerResponse:
    """Update a speaker's display name or user mapping."""
    result = await db.execute(
        select(MeetingParticipant).where(MeetingParticipant.id == participant_id)
    )
    participant = result.scalar_one_or_none()
    if participant is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Participant {participant_id} not found",
        )

    if body.display_name is not None:
        participant.display_name = body.display_name
        # Also update the speaker_name in related utterances
        transcript_result = await db.execute(
            select(Transcript).where(Transcript.meeting_id == participant.meeting_id)
        )
        transcript = transcript_result.scalar_one_or_none()
        if transcript and participant.speaker_index is not None:
            utterance_result = await db.execute(
                select(TranscriptUtterance).where(
                    TranscriptUtterance.transcript_id == transcript.id,
                    TranscriptUtterance.speaker_index == participant.speaker_index,
                )
            )
            utterances = utterance_result.scalars().all()
            for utterance in utterances:
                utterance.speaker_name = body.display_name

    if body.user_id is not None:
        participant.user_id = body.user_id

    await db.flush()
    await db.refresh(participant)
    return SpeakerResponse.model_validate(participant)


@router.post("/meeting/{meeting_id}/identify", response_model=list[SpeakerResponse])
async def auto_identify_speakers(
    meeting_id: UUID,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[SpeakerResponse]:
    """
    Auto-identify speakers by matching against past meeting data.

    Looks at previous meetings in the same project to find participants
    with matching speaker indices or similar talk patterns, then applies
    known display names and user mappings.
    """
    # Get the current meeting and its project
    meeting_result = await db.execute(
        select(Meeting).where(Meeting.id == meeting_id)
    )
    meeting = meeting_result.scalar_one_or_none()
    if meeting is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Meeting {meeting_id} not found",
        )

    # Get current meeting participants
    current_participants_result = await db.execute(
        select(MeetingParticipant)
        .where(MeetingParticipant.meeting_id == meeting_id)
        .order_by(MeetingParticipant.speaker_index)
    )
    current_participants = list(current_participants_result.scalars().all())

    if not current_participants:
        return []

    # If the meeting belongs to a project, look at past meetings in the same project
    if meeting.project_id is not None:
        # Get all participants from past meetings in the same project, who have user_id set
        past_participants_result = await db.execute(
            select(MeetingParticipant)
            .join(Meeting, MeetingParticipant.meeting_id == Meeting.id)
            .where(
                Meeting.project_id == meeting.project_id,
                Meeting.id != meeting_id,
                MeetingParticipant.user_id.isnot(None),
            )
        )
        past_participants = past_participants_result.scalars().all()

        # Build a mapping of display_name -> (user_id, display_name) from past data
        name_to_user: dict[str, tuple] = {}
        for pp in past_participants:
            normalized = pp.display_name.strip().lower()
            if normalized not in name_to_user:
                name_to_user[normalized] = (pp.user_id, pp.display_name)

        # Match current participants by display_name similarity
        for participant in current_participants:
            if participant.user_id is not None:
                continue  # Already identified

            normalized = participant.display_name.strip().lower()
            if normalized in name_to_user:
                user_id, display_name = name_to_user[normalized]
                participant.user_id = user_id
                participant.display_name = display_name

    await db.flush()

    # Refresh and return updated participants
    updated_result = await db.execute(
        select(MeetingParticipant)
        .where(MeetingParticipant.meeting_id == meeting_id)
        .order_by(MeetingParticipant.speaker_index)
    )
    updated_participants = updated_result.scalars().all()
    return [SpeakerResponse.model_validate(p) for p in updated_participants]
