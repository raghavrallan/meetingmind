import uuid
from datetime import datetime, timezone
import enum

from sqlalchemy import String, DateTime, Text, ForeignKey, Float, Enum as SAEnum, Index
from sqlalchemy.dialects.postgresql import UUID
from pgvector.sqlalchemy import Vector
from sqlalchemy.orm import Mapped, mapped_column

from shared.database import Base


class ContentType(str, enum.Enum):
    UTTERANCE = "utterance"
    SUMMARY = "summary"
    ACTION_ITEM = "action_item"
    DECISION = "decision"
    KEY_POINT = "key_point"


class MeetingEmbedding(Base):
    __tablename__ = "meeting_embeddings"
    __table_args__ = (
        Index(
            "ix_embeddings_vector",
            "embedding",
            postgresql_using="hnsw",
            postgresql_with={"m": 16, "ef_construction": 64},
            postgresql_ops={"embedding": "vector_cosine_ops"},
        ),
        Index("ix_embeddings_project_type", "project_id", "content_type"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    meeting_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("meetings.id"), nullable=False)
    project_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("projects.id"), nullable=True)

    content_type: Mapped[ContentType] = mapped_column(SAEnum(ContentType), nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    speaker_name: Mapped[str | None] = mapped_column(String(255), nullable=True)

    start_time: Mapped[float | None] = mapped_column(Float, nullable=True)
    end_time: Mapped[float | None] = mapped_column(Float, nullable=True)

    embedding = mapped_column(Vector(1536), nullable=False)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
