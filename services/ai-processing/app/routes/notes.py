import json
import time
from uuid import UUID

import anthropic
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from shared.auth import get_current_user
from shared.credits import check_and_deduct_credits, CREDIT_COSTS, InsufficientCreditsError
from shared.database import get_db
from shared.models import MeetingNote, Meeting, Transcript
from shared.platform_keys import get_platform_key

from ..models import NotesResponse, NoteRegenerateRequest
from ..prompts import MEETING_NOTES_SYSTEM_PROMPT, MEETING_NOTES_USER_PROMPT
from ..rag import build_context

router = APIRouter(prefix="/notes", tags=["notes"])

MODEL_NAME = "claude-sonnet-4-20250514"


@router.get("/meeting/{meeting_id}", response_model=NotesResponse)
async def get_meeting_notes(
    meeting_id: UUID,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> NotesResponse:
    """Get the latest version of notes for a meeting."""
    result = await db.execute(
        select(MeetingNote)
        .where(MeetingNote.meeting_id == meeting_id)
        .order_by(MeetingNote.version.desc())
        .limit(1)
    )
    note = result.scalar_one_or_none()
    if note is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"No notes found for meeting {meeting_id}",
        )
    return NotesResponse.model_validate(note)


@router.get("/meeting/{meeting_id}/versions", response_model=list[NotesResponse])
async def list_note_versions(
    meeting_id: UUID,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[NotesResponse]:
    """List all note versions for a meeting, newest first."""
    result = await db.execute(
        select(MeetingNote)
        .where(MeetingNote.meeting_id == meeting_id)
        .order_by(MeetingNote.version.desc())
    )
    notes = result.scalars().all()
    if not notes:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"No notes found for meeting {meeting_id}",
        )
    return [NotesResponse.model_validate(n) for n in notes]


@router.post("/meeting/{meeting_id}/regenerate", response_model=NotesResponse)
async def regenerate_notes(
    meeting_id: UUID,
    body: NoteRegenerateRequest | None = None,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> NotesResponse:
    """
    Regenerate notes for a meeting using the AI pipeline.
    Creates a new version rather than overwriting existing notes.
    """
    if body is None:
        body = NoteRegenerateRequest()

    # Verify meeting exists and get its project_id
    meeting_result = await db.execute(
        select(Meeting).where(Meeting.id == meeting_id)
    )
    meeting = meeting_result.scalar_one_or_none()
    if meeting is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Meeting {meeting_id} not found",
        )

    # Get the transcript
    transcript_result = await db.execute(
        select(Transcript).where(Transcript.meeting_id == meeting_id)
    )
    transcript = transcript_result.scalar_one_or_none()
    if transcript is None or not transcript.full_text:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"No transcript available for meeting {meeting_id}",
        )

    # Deduct credits before AI generation
    user_id = UUID(current_user["sub"])
    try:
        await check_and_deduct_credits(
            db,
            user_id=user_id,
            cost=CREDIT_COSTS["note_generation"],
            operation="note_generation",
            provider="anthropic",
            meeting_id=meeting_id,
            description="Regenerate meeting notes",
        )
    except InsufficientCreditsError as e:
        raise HTTPException(
            status_code=status.HTTP_402_PAYMENT_REQUIRED,
            detail=str(e),
        )

    # Get platform API key for Anthropic
    api_key = await get_platform_key(db, "anthropic")
    if not api_key:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Anthropic API key not configured",
        )
    client = anthropic.AsyncAnthropic(api_key=api_key)

    # Build RAG context from past meetings
    context = await build_context(db, meeting_id, meeting.project_id)

    # Determine the next version number
    version_result = await db.execute(
        select(func.coalesce(func.max(MeetingNote.version), 0))
        .where(MeetingNote.meeting_id == meeting_id)
    )
    current_max_version = version_result.scalar()
    next_version = current_max_version + 1

    # Build the prompt
    language = body.language or meeting.language or "en"
    user_prompt = MEETING_NOTES_USER_PROMPT.format(
        context=context,
        transcript=transcript.full_text,
        language=language,
    )

    if body.custom_instructions:
        user_prompt += f"\n\n## Additional instructions\n{body.custom_instructions}"

    # Call Claude to generate notes
    start_time = time.time()
    try:
        response = await client.messages.create(
            model=MODEL_NAME,
            max_tokens=4096,
            system=MEETING_NOTES_SYSTEM_PROMPT,
            messages=[
                {"role": "user", "content": user_prompt},
            ],
        )
    except anthropic.APIError as e:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"AI generation failed: {str(e)}",
        )

    generation_time_ms = int((time.time() - start_time) * 1000)

    # Parse the AI response
    response_text = response.content[0].text
    try:
        notes_data = json.loads(response_text)
    except json.JSONDecodeError:
        # Try to extract JSON from the response if it contains extra text
        import re
        json_match = re.search(r'\{[\s\S]*\}', response_text)
        if json_match:
            try:
                notes_data = json.loads(json_match.group())
            except json.JSONDecodeError:
                raise HTTPException(
                    status_code=status.HTTP_502_BAD_GATEWAY,
                    detail="AI returned invalid JSON for notes",
                )
        else:
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail="AI returned invalid JSON for notes",
            )

    # Count context chunks used
    context_chunks = len(context.split("---")) if context != "No prior context available." else 0

    # Create the new note version
    new_note = MeetingNote(
        meeting_id=meeting_id,
        version=next_version,
        executive_summary=notes_data.get("executive_summary", ""),
        key_points=notes_data.get("key_points"),
        decisions=notes_data.get("decisions"),
        action_items=notes_data.get("action_items"),
        open_questions=notes_data.get("open_questions"),
        topics_discussed=notes_data.get("topics_discussed"),
        full_notes_markdown=notes_data.get("full_notes_markdown", ""),
        model_used=MODEL_NAME,
        context_chunks_used=context_chunks,
        generation_time_ms=generation_time_ms,
    )

    db.add(new_note)
    await db.flush()
    await db.refresh(new_note)

    return NotesResponse.model_validate(new_note)
