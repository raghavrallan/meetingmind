from datetime import datetime
from typing import Optional
from uuid import UUID

from pydantic import BaseModel, Field


class NotesResponse(BaseModel):
    id: UUID
    meeting_id: UUID
    version: int
    executive_summary: str
    key_points: Optional[list] = None
    decisions: Optional[list] = None
    action_items: Optional[list] = None
    open_questions: Optional[list] = None
    topics_discussed: Optional[list] = None
    full_notes_markdown: str
    model_used: str
    context_chunks_used: int = 0
    generation_time_ms: Optional[int] = None
    created_at: datetime

    model_config = {"from_attributes": True}


class NoteRegenerateRequest(BaseModel):
    custom_instructions: Optional[str] = Field(
        default=None,
        max_length=1000,
        description="Additional instructions for note regeneration",
    )
    language: Optional[str] = Field(
        default="en",
        description="Target language for generated notes",
    )


class RAGContext(BaseModel):
    content: str
    meeting_id: UUID
    meeting_title: Optional[str] = None
    content_type: str
    speaker_name: Optional[str] = None
    similarity_score: float


class QueryRequest(BaseModel):
    question: str = Field(..., min_length=1, max_length=2000)
    project_id: Optional[UUID] = None
    meeting_ids: Optional[list[UUID]] = None


class QueryResponse(BaseModel):
    answer: str
    sources: list[RAGContext] = []
    model_used: str
    tokens_used: Optional[int] = None
