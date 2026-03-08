from datetime import datetime, timedelta, timezone
from uuid import UUID

import numpy as np
import openai
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from shared.database import async_session
from shared.models import MeetingEmbedding, Meeting
from shared.platform_keys import get_platform_key


async def get_embedding(text_input: str, db: AsyncSession | None = None) -> list[float]:
    """Generate an embedding vector for the given text using OpenAI text-embedding-3-small."""
    if db is not None:
        api_key = await get_platform_key(db, "openai")
        if not api_key:
            raise RuntimeError("OpenAI API key not configured")
        client = openai.AsyncOpenAI(api_key=api_key)
        response = await client.embeddings.create(
            model="text-embedding-3-small",
            input=text_input,
        )
        return response.data[0].embedding

    async with async_session() as session:
        api_key = await get_platform_key(session, "openai")
        if not api_key:
            raise RuntimeError("OpenAI API key not configured")
        client = openai.AsyncOpenAI(api_key=api_key)
        response = await client.embeddings.create(
            model="text-embedding-3-small",
            input=text_input,
        )
        return response.data[0].embedding


async def search_similar(
    db: AsyncSession,
    query_embedding: list[float],
    project_id: UUID | None = None,
    meeting_ids: list[UUID] | None = None,
    limit: int = 10,
    days: int = 90,
) -> list[dict]:
    """
    Query pgvector for similar content using cosine similarity.

    Supports filtering by project_id and/or specific meeting_ids,
    and limits results to content from the last N days.
    """
    cutoff_date = datetime.now(timezone.utc) - timedelta(days=days)

    # Convert embedding to the pgvector format string
    embedding_str = "[" + ",".join(str(x) for x in query_embedding) + "]"

    # Build the base query using cosine distance operator (<=>)
    query = (
        select(
            MeetingEmbedding.id,
            MeetingEmbedding.meeting_id,
            MeetingEmbedding.content_type,
            MeetingEmbedding.content,
            MeetingEmbedding.speaker_name,
            MeetingEmbedding.start_time,
            MeetingEmbedding.end_time,
            Meeting.title.label("meeting_title"),
            Meeting.created_at.label("meeting_date"),
            # Cosine similarity = 1 - cosine distance
            (1 - MeetingEmbedding.embedding.cosine_distance(embedding_str)).label("similarity"),
        )
        .join(Meeting, MeetingEmbedding.meeting_id == Meeting.id)
        .where(MeetingEmbedding.created_at >= cutoff_date)
        .order_by(MeetingEmbedding.embedding.cosine_distance(embedding_str))
        .limit(limit)
    )

    if project_id is not None:
        query = query.where(MeetingEmbedding.project_id == project_id)

    if meeting_ids is not None and len(meeting_ids) > 0:
        query = query.where(MeetingEmbedding.meeting_id.in_(meeting_ids))

    result = await db.execute(query)
    rows = result.all()

    return [
        {
            "id": str(row.id),
            "meeting_id": str(row.meeting_id),
            "meeting_title": row.meeting_title,
            "meeting_date": row.meeting_date.isoformat() if row.meeting_date else None,
            "content_type": row.content_type.value if hasattr(row.content_type, "value") else row.content_type,
            "content": row.content,
            "speaker_name": row.speaker_name,
            "start_time": row.start_time,
            "end_time": row.end_time,
            "similarity": float(row.similarity),
        }
        for row in rows
    ]


async def build_context(
    db: AsyncSession,
    meeting_id: UUID,
    project_id: UUID | None = None,
) -> str:
    """
    Build RAG context for note generation by fetching similar past content.

    Retrieves the transcript text from the target meeting, embeds a summary,
    then searches for similar past content in the same project.
    """
    # Get the meeting's transcript text for embedding
    from shared.models import Transcript

    transcript_result = await db.execute(
        select(Transcript).where(Transcript.meeting_id == meeting_id)
    )
    transcript = transcript_result.scalar_one_or_none()

    if transcript is None or not transcript.full_text:
        return "No prior context available."

    # Use the first ~2000 characters of the transcript to generate a context query
    query_text = transcript.full_text[:2000]

    try:
        query_embedding = await get_embedding(query_text, db=db)
    except Exception:
        return "No prior context available (embedding generation failed)."

    # Search for similar past content, excluding the current meeting
    similar_items = await search_similar(
        db=db,
        query_embedding=query_embedding,
        project_id=project_id,
        limit=15,
        days=90,
    )

    # Filter out results from the current meeting
    similar_items = [
        item for item in similar_items
        if item["meeting_id"] != str(meeting_id)
    ]

    if not similar_items:
        return "No prior context available from similar meetings."

    # Format context for the prompt
    context_parts = []
    for item in similar_items:
        header = f"[{item['content_type']}] from \"{item['meeting_title']}\" ({item['meeting_date']})"
        if item["speaker_name"]:
            header += f" - {item['speaker_name']}"
        context_parts.append(f"{header}:\n{item['content']}")

    return "\n\n---\n\n".join(context_parts)
