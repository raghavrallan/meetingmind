from uuid import UUID

import anthropic
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from shared.auth import get_current_user
from shared.credits import check_and_deduct_credits, CREDIT_COSTS, InsufficientCreditsError
from shared.database import get_db
from shared.models import Meeting, MeetingParticipant, Transcript, MeetingNote
from shared.platform_keys import get_platform_key

from ..models import QueryRequest, QueryResponse, RAGContext
from ..prompts import RAG_QUERY_PROMPT, PRE_MEETING_BRIEF_PROMPT
from ..rag import get_embedding, search_similar, build_context

router = APIRouter(prefix="/queries", tags=["queries"])

MODEL_NAME = "claude-sonnet-4-20250514"


@router.post("/", response_model=QueryResponse)
async def query_meetings(
    body: QueryRequest,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> QueryResponse:
    """
    Ask an AI question about meetings using RAG.

    Embeds the question, retrieves relevant context from pgvector,
    then sends the question + context to Claude for an answer.
    """
    # Generate embedding for the question
    try:
        question_embedding = await get_embedding(body.question, db=db)
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Failed to generate embedding: {str(e)}",
        )

    # Search for similar content
    similar_items = await search_similar(
        db=db,
        query_embedding=question_embedding,
        project_id=body.project_id,
        meeting_ids=body.meeting_ids,
        limit=10,
        days=90,
    )

    if not similar_items:
        return QueryResponse(
            answer="I couldn't find any relevant meeting content to answer your question. "
                   "Make sure meetings have been recorded and processed in the selected project/timeframe.",
            sources=[],
            model_used=MODEL_NAME,
        )

    # Build context string from retrieved items
    context_parts = []
    sources = []
    for item in similar_items:
        header = f"[{item['content_type']}] from \"{item['meeting_title']}\" ({item['meeting_date']})"
        if item["speaker_name"]:
            header += f" - {item['speaker_name']}"
        context_parts.append(f"{header}:\n{item['content']}")

        sources.append(RAGContext(
            content=item["content"],
            meeting_id=UUID(item["meeting_id"]),
            meeting_title=item["meeting_title"],
            content_type=item["content_type"],
            speaker_name=item["speaker_name"],
            similarity_score=item["similarity"],
        ))

    context_str = "\n\n---\n\n".join(context_parts)

    # Deduct credits for RAG query
    user_id = UUID(current_user["sub"])
    try:
        await check_and_deduct_credits(
            db,
            user_id=user_id,
            cost=CREDIT_COSTS["rag_query"],
            operation="rag_query",
            provider="anthropic",
            description="RAG query",
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

    # Build the prompt
    prompt = RAG_QUERY_PROMPT.format(
        context=context_str,
        question=body.question,
    )

    # Call Claude
    try:
        response = await client.messages.create(
            model=MODEL_NAME,
            max_tokens=2048,
            messages=[
                {"role": "user", "content": prompt},
            ],
        )
    except anthropic.APIError as e:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"AI query failed: {str(e)}",
        )

    answer = response.content[0].text
    tokens_used = (response.usage.input_tokens + response.usage.output_tokens) if response.usage else None

    return QueryResponse(
        answer=answer,
        sources=sources,
        model_used=MODEL_NAME,
        tokens_used=tokens_used,
    )


@router.post("/pre-brief/{meeting_id}", response_model=QueryResponse)
async def generate_pre_brief(
    meeting_id: UUID,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> QueryResponse:
    """
    Generate a pre-meeting brief based on past meeting context.

    Uses RAG to find relevant past content related to the upcoming meeting's
    title, participants, and project, then generates a preparation brief.
    """
    # Get the meeting details
    meeting_result = await db.execute(
        select(Meeting).where(Meeting.id == meeting_id)
    )
    meeting = meeting_result.scalar_one_or_none()
    if meeting is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Meeting {meeting_id} not found",
        )

    # Get participants
    participants_result = await db.execute(
        select(MeetingParticipant)
        .where(MeetingParticipant.meeting_id == meeting_id)
    )
    participants = participants_result.scalars().all()
    participant_names = [p.display_name for p in participants]

    # Build context from past meetings using RAG
    context = await build_context(db, meeting_id, meeting.project_id)

    # If no transcript exists yet for this meeting (pre-meeting), use the title for context search
    if context == "No prior context available." and meeting.project_id:
        try:
            title_embedding = await get_embedding(meeting.title, db=db)
            similar_items = await search_similar(
                db=db,
                query_embedding=title_embedding,
                project_id=meeting.project_id,
                limit=15,
                days=90,
            )
            if similar_items:
                context_parts = []
                for item in similar_items:
                    header = f"[{item['content_type']}] from \"{item['meeting_title']}\" ({item['meeting_date']})"
                    if item["speaker_name"]:
                        header += f" - {item['speaker_name']}"
                    context_parts.append(f"{header}:\n{item['content']}")
                context = "\n\n---\n\n".join(context_parts)
        except Exception:
            pass  # Fall through with default context

    # Deduct credits for pre-meeting brief
    user_id = UUID(current_user["sub"])
    try:
        await check_and_deduct_credits(
            db,
            user_id=user_id,
            cost=CREDIT_COSTS["pre_meeting_brief"],
            operation="pre_meeting_brief",
            provider="anthropic",
            meeting_id=meeting_id,
            description="Pre-meeting brief generation",
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

    # Build the prompt
    prompt = PRE_MEETING_BRIEF_PROMPT.format(
        meeting_title=meeting.title,
        participants=", ".join(participant_names) if participant_names else "Unknown",
        context=context,
    )

    # Call Claude
    try:
        response = await client.messages.create(
            model=MODEL_NAME,
            max_tokens=2048,
            messages=[
                {"role": "user", "content": prompt},
            ],
        )
    except anthropic.APIError as e:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"AI brief generation failed: {str(e)}",
        )

    answer = response.content[0].text
    tokens_used = (response.usage.input_tokens + response.usage.output_tokens) if response.usage else None

    # Build source references from context
    sources = []
    if context != "No prior context available.":
        # Parse out meeting references from context for source attribution
        try:
            title_embedding = await get_embedding(meeting.title, db=db)
            similar_items = await search_similar(
                db=db,
                query_embedding=title_embedding,
                project_id=meeting.project_id,
                limit=10,
                days=90,
            )
            for item in similar_items:
                sources.append(RAGContext(
                    content=item["content"][:200],  # Truncate for response
                    meeting_id=UUID(item["meeting_id"]),
                    meeting_title=item["meeting_title"],
                    content_type=item["content_type"],
                    speaker_name=item["speaker_name"],
                    similarity_score=item["similarity"],
                ))
        except Exception:
            pass

    return QueryResponse(
        answer=answer,
        sources=sources,
        model_used=MODEL_NAME,
        tokens_used=tokens_used,
    )
