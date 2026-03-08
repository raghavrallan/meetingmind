import logging
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
from shared.platform_keys import get_platform_key
from shared.credits import check_and_deduct_credits, CREDIT_COSTS, InsufficientCreditsError

DATABASE_URL = os.getenv("DATABASE_URL", "postgresql+asyncpg://notetaker:notetaker_secret@postgres:5432/ai_notetaker")

logger = logging.getLogger(__name__)


def _make_session():
    eng = create_async_engine(DATABASE_URL, pool_size=2, max_overflow=0)
    return async_sessionmaker(eng, class_=AsyncSession, expire_on_commit=False), eng


async def _get_embedding(oai: openai.AsyncOpenAI, text: str) -> list[float]:
    response = await oai.embeddings.create(
        model="text-embedding-3-small",
        input=text[:8000],
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

    session_factory, eng = _make_session()
    try:
        async with session_factory() as session:
            meeting = await session.get(Meeting, mid)
            if not meeting:
                return

            openai_key = await get_platform_key(session, "openai")
            oai = openai.AsyncOpenAI(api_key=openai_key)

            result = await session.execute(
                select(MeetingNote)
                .where(MeetingNote.meeting_id == mid)
                .order_by(MeetingNote.version.desc())
                .limit(1)
            )
            note = result.scalar_one_or_none()

            result = await session.execute(
                select(TranscriptUtterance)
                .join(Transcript)
                .where(Transcript.meeting_id == mid)
                .order_by(TranscriptUtterance.start_time)
            )
            utterances = result.scalars().all()

            embeddings_to_create = []

            if note and note.executive_summary:
                vec = await _get_embedding(oai, note.executive_summary)
                embeddings_to_create.append(MeetingEmbedding(
                    meeting_id=mid, project_id=meeting.project_id,
                    content_type=ContentType.SUMMARY, content=note.executive_summary, embedding=vec,
                ))

            if note and note.decisions:
                for decision in note.decisions:
                    text = decision.get("decision", "") if isinstance(decision, dict) else str(decision)
                    if text:
                        vec = await _get_embedding(oai, text)
                        embeddings_to_create.append(MeetingEmbedding(
                            meeting_id=mid, project_id=meeting.project_id,
                            content_type=ContentType.DECISION, content=text, embedding=vec,
                        ))

            if note and note.action_items:
                for item in note.action_items:
                    text = item.get("item", "") if isinstance(item, dict) else str(item)
                    if text:
                        vec = await _get_embedding(oai, text)
                        embeddings_to_create.append(MeetingEmbedding(
                            meeting_id=mid, project_id=meeting.project_id,
                            content_type=ContentType.ACTION_ITEM, content=text, embedding=vec,
                        ))

            if note and note.key_points:
                for point in note.key_points:
                    text = point.get("text", "") if isinstance(point, dict) else str(point)
                    if text:
                        vec = await _get_embedding(oai, text)
                        embeddings_to_create.append(MeetingEmbedding(
                            meeting_id=mid, project_id=meeting.project_id,
                            content_type=ContentType.KEY_POINT, content=text, embedding=vec,
                        ))

            if utterances:
                window_size = 60.0
                current_window = []
                window_start = utterances[0].start_time

                for u in utterances:
                    if u.start_time - window_start > window_size and current_window:
                        chunk_text = " ".join(
                            f"{cu.speaker_name or f'Speaker {cu.speaker_index}'}: {cu.text}"
                            for cu in current_window
                        )
                        vec = await _get_embedding(oai, chunk_text)
                        embeddings_to_create.append(MeetingEmbedding(
                            meeting_id=mid, project_id=meeting.project_id,
                            content_type=ContentType.UTTERANCE, content=chunk_text,
                            start_time=current_window[0].start_time,
                            end_time=current_window[-1].end_time, embedding=vec,
                        ))
                        current_window = [u]
                        window_start = u.start_time
                    else:
                        current_window.append(u)

                if current_window:
                    chunk_text = " ".join(
                        f"{cu.speaker_name or f'Speaker {cu.speaker_index}'}: {cu.text}"
                        for cu in current_window
                    )
                    vec = await _get_embedding(oai, chunk_text)
                    embeddings_to_create.append(MeetingEmbedding(
                        meeting_id=mid, project_id=meeting.project_id,
                        content_type=ContentType.UTTERANCE, content=chunk_text,
                        start_time=current_window[0].start_time,
                        end_time=current_window[-1].end_time, embedding=vec,
                    ))

            session.add_all(embeddings_to_create)
            await session.commit()

            try:
                await check_and_deduct_credits(
                    session,
                    user_id=meeting.created_by_id,
                    cost=CREDIT_COSTS["embedding_generation"],
                    operation="embedding_generation",
                    provider="openai",
                    meeting_id=mid,
                )
                await session.commit()
            except InsufficientCreditsError:
                logger.warning(
                    "Insufficient credits for user %s (meeting %s) — "
                    "embedding_generation deduction skipped",
                    meeting.created_by_id, meeting_id,
                )

            return {"meeting_id": meeting_id, "embeddings_created": len(embeddings_to_create)}
    finally:
        await eng.dispose()


@app.task(name="embedding_worker.embed_meeting_content", bind=True, max_retries=3)
def embed_meeting_content(self, meeting_id: str):
    try:
        return asyncio.run(_embed_meeting(meeting_id))
    except Exception as exc:
        self.retry(exc=exc, countdown=30)
