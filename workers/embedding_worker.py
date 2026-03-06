import os
import asyncio
from uuid import UUID

import openai
from celery_app import app
from sqlalchemy import select
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession

from shared.models import (
    Meeting, Transcript, TranscriptUtterance, MeetingNote, MeetingEmbedding,
)
from shared.models.embedding import ContentType

DATABASE_URL = os.getenv("DATABASE_URL", "postgresql+asyncpg://notetaker:notetaker_secret@postgres:5432/ai_notetaker")
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "")

engine = create_async_engine(DATABASE_URL, pool_size=5)
async_session = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

oai = openai.AsyncOpenAI(api_key=OPENAI_API_KEY)


async def _get_embedding(text: str) -> list[float]:
    response = await oai.embeddings.create(
        model="text-embedding-3-small",
        input=text[:8000],  # Truncate to stay within limits
    )
    return response.data[0].embedding


def _chunk_text(text: str, max_chars: int = 1000) -> list[str]:
    """Split text into chunks at sentence boundaries."""
    sentences = text.replace("\n", " ").split(". ")
    chunks = []
    current = ""
    for sentence in sentences:
        if len(current) + len(sentence) > max_chars and current:
            chunks.append(current.strip())
            current = sentence
        else:
            current = f"{current}. {sentence}" if current else sentence
    if current.strip():
        chunks.append(current.strip())
    return chunks


async def _embed_meeting(meeting_id: str):
    mid = UUID(meeting_id)

    async with async_session() as session:
        meeting = await session.get(Meeting, mid)
        if not meeting:
            return

        # Get latest notes
        result = await session.execute(
            select(MeetingNote)
            .where(MeetingNote.meeting_id == mid)
            .order_by(MeetingNote.version.desc())
            .limit(1)
        )
        note = result.scalar_one_or_none()

        # Get utterances
        result = await session.execute(
            select(TranscriptUtterance)
            .join(Transcript)
            .where(Transcript.meeting_id == mid)
            .order_by(TranscriptUtterance.start_time)
        )
        utterances = result.scalars().all()

        embeddings_to_create = []

        # Embed executive summary
        if note and note.executive_summary:
            vec = await _get_embedding(note.executive_summary)
            embeddings_to_create.append(MeetingEmbedding(
                meeting_id=mid,
                project_id=meeting.project_id,
                content_type=ContentType.SUMMARY,
                content=note.executive_summary,
                embedding=vec,
            ))

        # Embed decisions
        if note and note.decisions:
            for decision in note.decisions:
                text = decision.get("decision", "")
                if text:
                    vec = await _get_embedding(text)
                    embeddings_to_create.append(MeetingEmbedding(
                        meeting_id=mid,
                        project_id=meeting.project_id,
                        content_type=ContentType.DECISION,
                        content=text,
                        embedding=vec,
                    ))

        # Embed action items
        if note and note.action_items:
            for item in note.action_items:
                text = item.get("item", "")
                if text:
                    vec = await _get_embedding(text)
                    embeddings_to_create.append(MeetingEmbedding(
                        meeting_id=mid,
                        project_id=meeting.project_id,
                        content_type=ContentType.ACTION_ITEM,
                        content=text,
                        embedding=vec,
                    ))

        # Embed key points
        if note and note.key_points:
            for point in note.key_points:
                text = point.get("text", "")
                if text:
                    vec = await _get_embedding(text)
                    embeddings_to_create.append(MeetingEmbedding(
                        meeting_id=mid,
                        project_id=meeting.project_id,
                        content_type=ContentType.KEY_POINT,
                        content=text,
                        embedding=vec,
                    ))

        # Embed utterance chunks (group by ~60 second windows)
        if utterances:
            window_size = 60.0  # seconds
            current_window = []
            window_start = utterances[0].start_time if utterances else 0

            for u in utterances:
                if u.start_time - window_start > window_size and current_window:
                    chunk_text = " ".join(
                        f"{cu.speaker_name or f'Speaker {cu.speaker_index}'}: {cu.text}"
                        for cu in current_window
                    )
                    vec = await _get_embedding(chunk_text)
                    embeddings_to_create.append(MeetingEmbedding(
                        meeting_id=mid,
                        project_id=meeting.project_id,
                        content_type=ContentType.UTTERANCE,
                        content=chunk_text,
                        speaker_name=None,
                        start_time=current_window[0].start_time,
                        end_time=current_window[-1].end_time,
                        embedding=vec,
                    ))
                    current_window = [u]
                    window_start = u.start_time
                else:
                    current_window.append(u)

            # Final window
            if current_window:
                chunk_text = " ".join(
                    f"{cu.speaker_name or f'Speaker {cu.speaker_index}'}: {cu.text}"
                    for cu in current_window
                )
                vec = await _get_embedding(chunk_text)
                embeddings_to_create.append(MeetingEmbedding(
                    meeting_id=mid,
                    project_id=meeting.project_id,
                    content_type=ContentType.UTTERANCE,
                    content=chunk_text,
                    start_time=current_window[0].start_time,
                    end_time=current_window[-1].end_time,
                    embedding=vec,
                ))

        # Bulk save
        session.add_all(embeddings_to_create)
        await session.commit()

        return {"meeting_id": meeting_id, "embeddings_created": len(embeddings_to_create)}


@app.task(name="embedding_worker.embed_meeting_content", bind=True, max_retries=3)
def embed_meeting_content(self, meeting_id: str):
    try:
        return asyncio.run(_embed_meeting(meeting_id))
    except Exception as exc:
        self.retry(exc=exc, countdown=30)
