import uuid
from datetime import datetime, timezone

from sqlalchemy import String, DateTime, Text, ForeignKey, Integer, Float, Index
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from shared.database import Base


class Transcript(Base):
    __tablename__ = "transcripts"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    meeting_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("meetings.id"), unique=True, nullable=False
    )

    full_text: Mapped[str] = mapped_column(Text, nullable=False, default="")
    raw_deepgram_json: Mapped[dict | None] = mapped_column(JSONB, nullable=True)

    language_detected: Mapped[str | None] = mapped_column(String(10), nullable=True)
    word_count: Mapped[int] = mapped_column(Integer, default=0)
    confidence_avg: Mapped[float | None] = mapped_column(Float, nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )

    # Relationships
    meeting: Mapped["Meeting"] = relationship(back_populates="transcript")
    utterances: Mapped[list["TranscriptUtterance"]] = relationship(
        back_populates="transcript", cascade="all, delete-orphan", order_by="TranscriptUtterance.start_time"
    )


class TranscriptUtterance(Base):
    __tablename__ = "transcript_utterances"
    __table_args__ = (
        Index("ix_utterances_transcript_speaker", "transcript_id", "speaker_index"),
        Index("ix_utterances_fulltext", "text", postgresql_using="gin", postgresql_ops={"text": "gin_trgm_ops"}),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    transcript_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("transcripts.id"), nullable=False
    )

    speaker_index: Mapped[int] = mapped_column(Integer, nullable=False)
    speaker_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    channel: Mapped[int] = mapped_column(Integer, default=0)

    text: Mapped[str] = mapped_column(Text, nullable=False)
    start_time: Mapped[float] = mapped_column(Float, nullable=False)
    end_time: Mapped[float] = mapped_column(Float, nullable=False)
    confidence: Mapped[float] = mapped_column(Float, default=0.0)

    # Word-level timing data
    words_json: Mapped[dict | None] = mapped_column(JSONB, nullable=True)

    # Relationships
    transcript: Mapped["Transcript"] = relationship(back_populates="utterances")
