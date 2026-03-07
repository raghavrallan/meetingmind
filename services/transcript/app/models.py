from datetime import datetime, date
from typing import Optional
from uuid import UUID

from pydantic import BaseModel, Field


class UtteranceResponse(BaseModel):
    id: UUID
    transcript_id: UUID
    speaker_index: int
    speaker_name: Optional[str] = None
    channel: int = 0
    text: str
    start_time: float
    end_time: float
    confidence: float = 0.0
    words_json: Optional[list | dict] = None

    model_config = {"from_attributes": True}


class TranscriptResponse(BaseModel):
    id: UUID
    meeting_id: UUID
    full_text: str
    language_detected: Optional[str] = None
    word_count: int = 0
    confidence_avg: Optional[float] = None
    created_at: datetime
    utterances: list[UtteranceResponse] = []

    model_config = {"from_attributes": True}


class TranscriptSearchRequest(BaseModel):
    query: str = Field(..., min_length=1, max_length=500)
    project_id: Optional[UUID] = None
    date_from: Optional[date] = None
    date_to: Optional[date] = None
    limit: int = Field(default=20, ge=1, le=100)
    offset: int = Field(default=0, ge=0)


class TranscriptSearchResult(BaseModel):
    utterance_id: UUID
    transcript_id: UUID
    meeting_id: UUID
    meeting_title: str
    speaker_name: Optional[str] = None
    text: str
    start_time: float
    end_time: float
    meeting_date: Optional[datetime] = None

    model_config = {"from_attributes": True}


class TranscriptUpdate(BaseModel):
    full_text: Optional[str] = None


class SpeakerResponse(BaseModel):
    id: UUID
    meeting_id: UUID
    user_id: Optional[UUID] = None
    display_name: str
    speaker_index: Optional[int] = None
    channel_index: Optional[int] = None
    talk_time_seconds: float = 0.0
    word_count: int = 0

    model_config = {"from_attributes": True}


class SpeakerUpdate(BaseModel):
    display_name: Optional[str] = None
    user_id: Optional[UUID] = None
