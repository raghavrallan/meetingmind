import uuid
from datetime import datetime, timezone

from sqlalchemy import String, DateTime, Text, ForeignKey, Integer
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from shared.database import Base


class MeetingNote(Base):
    __tablename__ = "meeting_notes"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    meeting_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("meetings.id"), nullable=False)

    version: Mapped[int] = mapped_column(Integer, default=1)

    # AI-generated content
    executive_summary: Mapped[str] = mapped_column(Text, nullable=False, default="")
    key_points: Mapped[list | None] = mapped_column(JSONB, nullable=True)  # [{text, speaker, timestamp}]
    decisions: Mapped[list | None] = mapped_column(JSONB, nullable=True)  # [{decision, context, participants}]
    action_items: Mapped[list | None] = mapped_column(JSONB, nullable=True)  # [{item, assignee, due_date, priority}]
    open_questions: Mapped[list | None] = mapped_column(JSONB, nullable=True)  # [{question, context}]
    topics_discussed: Mapped[list | None] = mapped_column(JSONB, nullable=True)  # [{topic, duration_pct}]

    # Full formatted notes
    full_notes_markdown: Mapped[str] = mapped_column(Text, nullable=False, default="")

    # Generation metadata
    model_used: Mapped[str] = mapped_column(String(100), default="claude-sonnet-4-20250514")
    context_chunks_used: Mapped[int] = mapped_column(Integer, default=0)
    generation_time_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )

    # Relationships
    meeting: Mapped["Meeting"] = relationship(back_populates="notes")
