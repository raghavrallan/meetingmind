import json
import logging
import os
import time
import asyncio
from datetime import datetime, timedelta, timezone, date
from uuid import UUID

import anthropic
from celery_app import app
from sqlalchemy import select
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession

from shared.models import Meeting, Transcript, TranscriptUtterance, MeetingNote, Task, MeetingEmbedding
from shared.models.meeting import MeetingStatus
from shared.models.task import TaskStatus, TaskPriority
from shared.platform_keys import get_platform_key
from shared.credits import check_and_deduct_credits, CREDIT_COSTS, InsufficientCreditsError

DATABASE_URL = os.getenv("DATABASE_URL", "postgresql+asyncpg://notetaker:notetaker_secret@postgres:5432/ai_notetaker")

logger = logging.getLogger(__name__)


def _make_session():
    """Create a fresh engine+session per invocation to avoid async pool conflicts."""
    eng = create_async_engine(DATABASE_URL, pool_size=2, max_overflow=0)
    return async_sessionmaker(eng, class_=AsyncSession, expire_on_commit=False), eng

NOTES_SYSTEM_PROMPT = """You are an expert meeting note-taker. Given a meeting transcript and optional context from previous meetings, generate comprehensive structured meeting notes.

Return a JSON object with this exact structure:
{
  "executive_summary": "2-3 sentence summary of the meeting",
  "key_points": [{"text": "point", "speaker": "name or null", "timestamp": 0.0}],
  "decisions": [{"decision": "what was decided", "context": "why/how", "participants": ["names"]}],
  "action_items": [{"item": "task description", "assignee": "person name or null", "due_date": "YYYY-MM-DD or null", "priority": "low|medium|high|urgent"}],
  "open_questions": [{"question": "unresolved question", "context": "relevant context"}],
  "topics_discussed": [{"topic": "topic name", "duration_pct": 25}],
  "full_notes_markdown": "## Meeting Notes\\n\\nFull formatted notes in markdown..."
}"""

TASK_EXTRACTION_PROMPT = """Based on the meeting notes action items, extract tasks. For each action item, determine:
1. A clear task title
2. Who should own it (match to known team members if possible)
3. Priority (low/medium/high/urgent)
4. Due date if mentioned

Return JSON array of tasks."""


def _parse_due_date(raw: str | None) -> date | None:
    """Best-effort parse of a due date string from AI output."""
    if not raw:
        return None
    raw = raw.strip().lower()
    today = datetime.now(timezone.utc).date()

    relative_map = {
        "today": 0, "tomorrow": 1, "end of day": 0, "eod": 0,
        "end of week": (4 - today.weekday()) % 7 or 7,
        "next week": 7, "next monday": (7 - today.weekday()) % 7 or 7,
    }
    for phrase, days in relative_map.items():
        if phrase in raw:
            return today + timedelta(days=days)

    for day_name, offset in [
        ("monday", 0), ("tuesday", 1), ("wednesday", 2), ("thursday", 3),
        ("friday", 4), ("saturday", 5), ("sunday", 6),
    ]:
        if day_name in raw:
            days_ahead = (offset - today.weekday()) % 7 or 7
            return today + timedelta(days=days_ahead)

    for fmt in ("%Y-%m-%d", "%m/%d/%Y", "%m/%d", "%B %d", "%b %d"):
        try:
            parsed = datetime.strptime(raw, fmt).date()
            if parsed.year == 1900:
                parsed = parsed.replace(year=today.year)
            return parsed
        except ValueError:
            continue

    return None


async def _get_transcript(session: AsyncSession, meeting_id: UUID) -> str:
    result = await session.execute(
        select(TranscriptUtterance)
        .join(Transcript)
        .where(Transcript.meeting_id == meeting_id)
        .order_by(TranscriptUtterance.start_time)
    )
    utterances = result.scalars().all()
    lines = []
    for u in utterances:
        speaker = u.speaker_name or f"Speaker {u.speaker_index}"
        timestamp = f"[{int(u.start_time // 60)}:{int(u.start_time % 60):02d}]"
        lines.append(f"{timestamp} {speaker}: {u.text}")
    return "\n".join(lines)


async def _get_rag_context(session: AsyncSession, meeting_id: UUID, project_id: UUID | None) -> str:
    if not project_id:
        return ""
    # Get recent embeddings from same project
    from pgvector.sqlalchemy import Vector
    result = await session.execute(
        select(MeetingEmbedding.content, MeetingEmbedding.content_type)
        .where(MeetingEmbedding.project_id == project_id)
        .where(MeetingEmbedding.meeting_id != meeting_id)
        .order_by(MeetingEmbedding.created_at.desc())
        .limit(10)
    )
    rows = result.all()
    if not rows:
        return ""
    context_parts = []
    for content, content_type in rows:
        context_parts.append(f"[{content_type}] {content}")
    return "\n---\n".join(context_parts)


async def _generate_notes(meeting_id: str):
    mid = UUID(meeting_id)
    start = time.time()

    session_factory, eng = _make_session()
    try:
        async with session_factory() as session:
            meeting = await session.get(Meeting, mid)
            if not meeting:
                raise ValueError(f"Meeting {meeting_id} not found")

            transcript_text = await _get_transcript(session, mid)
            if not transcript_text:
                raise ValueError(f"No transcript found for meeting {meeting_id}")

            context = await _get_rag_context(session, mid, meeting.project_id)

            anthropic_key = await get_platform_key(session, "anthropic")
            claude = anthropic.AsyncAnthropic(api_key=anthropic_key)

            user_message = f"## Meeting: {meeting.title}\n\n"
            if context:
                user_message += f"## Previous Context from this project:\n{context}\n\n"
            user_message += f"## Transcript:\n{transcript_text}"

            response = await claude.messages.create(
                model="claude-sonnet-4-20250514",
                max_tokens=4096,
                system=NOTES_SYSTEM_PROMPT,
                messages=[{"role": "user", "content": user_message}],
            )

            response_text = response.content[0].text
            try:
                if "```json" in response_text:
                    response_text = response_text.split("```json")[1].split("```")[0]
                notes_data = json.loads(response_text)
            except json.JSONDecodeError:
                notes_data = {
                    "executive_summary": response_text[:500],
                    "full_notes_markdown": response_text,
                }

            generation_time_ms = int((time.time() - start) * 1000)

            result = await session.execute(
                select(MeetingNote)
                .where(MeetingNote.meeting_id == mid)
                .order_by(MeetingNote.version.desc())
                .limit(1)
            )
            latest = result.scalar_one_or_none()
            version = (latest.version + 1) if latest else 1

            note = MeetingNote(
                meeting_id=mid,
                version=version,
                executive_summary=notes_data.get("executive_summary", ""),
                key_points=notes_data.get("key_points"),
                decisions=notes_data.get("decisions"),
                action_items=notes_data.get("action_items"),
                open_questions=notes_data.get("open_questions"),
                topics_discussed=notes_data.get("topics_discussed"),
                full_notes_markdown=notes_data.get("full_notes_markdown", ""),
                context_chunks_used=10 if context else 0,
                generation_time_ms=generation_time_ms,
            )
            session.add(note)

            action_items = notes_data.get("action_items", [])
            for item in action_items:
                title = item.get("item", "") or item.get("task", "") or "Untitled task"
                priority_str = (item.get("priority", "medium") or "medium").lower()
                try:
                    priority = TaskPriority(priority_str)
                except ValueError:
                    priority = TaskPriority.MEDIUM
                due = _parse_due_date(item.get("due_date") or item.get("due"))
                task = Task(
                    title=title[:500],
                    description=title,
                    priority=priority,
                    project_id=meeting.project_id,
                    source_meeting_id=mid,
                    created_by_id=meeting.created_by_id,
                    status=TaskStatus.OPEN,
                    due_date=due,
                )
                session.add(task)

            meeting.status = MeetingStatus.COMPLETED
            await session.commit()

            try:
                await check_and_deduct_credits(
                    session,
                    user_id=meeting.created_by_id,
                    cost=CREDIT_COSTS["note_generation"],
                    operation="note_generation",
                    provider="anthropic",
                    meeting_id=mid,
                    duration_ms=generation_time_ms,
                )
                await session.commit()
            except InsufficientCreditsError:
                logger.warning(
                    "Insufficient credits for user %s (meeting %s) — "
                    "note_generation deduction skipped",
                    meeting.created_by_id, meeting_id,
                )

            return {"note_id": str(note.id), "version": version}
    finally:
        await eng.dispose()


@app.task(name="ai_worker.generate_meeting_notes", bind=True, max_retries=3)
def generate_meeting_notes(self, meeting_id: str):
    try:
        result = asyncio.run(_generate_notes(meeting_id))
        # Trigger embedding generation
        from embedding_worker import embed_meeting_content
        embed_meeting_content.delay(meeting_id)
        return result
    except Exception as exc:
        self.retry(exc=exc, countdown=30)


@app.task(name="ai_worker.regenerate_notes")
def regenerate_notes(meeting_id: str):
    return asyncio.run(_generate_notes(meeting_id))
