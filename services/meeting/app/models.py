from datetime import datetime
from typing import Optional
from uuid import UUID

from pydantic import BaseModel


class MeetingCreate(BaseModel):
    title: str
    project_id: Optional[UUID] = None
    language: str = "en"
    scheduled_start: Optional[datetime] = None
    scheduled_end: Optional[datetime] = None
    calendar_event_id: Optional[str] = None
    calendar_provider: Optional[str] = None


class MeetingUpdate(BaseModel):
    title: Optional[str] = None
    project_id: Optional[UUID] = None
    language: Optional[str] = None
    scheduled_start: Optional[datetime] = None
    scheduled_end: Optional[datetime] = None


class ParticipantResponse(BaseModel):
    id: UUID
    display_name: str
    speaker_index: Optional[int] = None
    channel_index: Optional[int] = None
    talk_time_seconds: float = 0.0
    word_count: int = 0

    model_config = {"from_attributes": True}


class MeetingResponse(BaseModel):
    id: UUID
    title: str
    status: str
    project_id: Optional[UUID] = None
    created_by_id: UUID
    audio_storage_key: Optional[str] = None
    duration_seconds: Optional[float] = None
    language: str = "en"
    scheduled_start: Optional[datetime] = None
    scheduled_end: Optional[datetime] = None
    actual_start: Optional[datetime] = None
    actual_end: Optional[datetime] = None
    calendar_event_id: Optional[str] = None
    calendar_provider: Optional[str] = None
    participants: list[ParticipantResponse] = []
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class MeetingListResponse(BaseModel):
    meetings: list[MeetingResponse]
    total: int
    page: int
    per_page: int
