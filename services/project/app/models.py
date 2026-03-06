from datetime import datetime
from typing import Optional
from uuid import UUID

from pydantic import BaseModel, Field


# ─── Project Schemas ─────────────────────────────────────

class ProjectCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)
    description: Optional[str] = None
    color: str = Field(default="#6366f1", pattern=r"^#[0-9a-fA-F]{6}$")


class ProjectUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=255)
    description: Optional[str] = None
    color: Optional[str] = Field(default=None, pattern=r"^#[0-9a-fA-F]{6}$")
    is_archived: Optional[bool] = None


class ProjectResponse(BaseModel):
    id: UUID
    name: str
    description: Optional[str] = None
    color: str
    is_archived: bool
    owner_id: UUID
    brief: Optional[str] = None
    meeting_count: int = 0
    member_count: int = 0
    created_at: datetime

    model_config = {"from_attributes": True}


class ProjectListResponse(BaseModel):
    projects: list[ProjectResponse]
    total: int


# ─── Member Schemas ──────────────────────────────────────

class MemberAdd(BaseModel):
    user_id: UUID
    role: str = Field(default="member", pattern=r"^(admin|member|viewer)$")


class MemberResponse(BaseModel):
    id: UUID
    user_id: UUID
    name: str
    email: str
    role: str
    joined_at: datetime

    model_config = {"from_attributes": True}


# ─── Team / People Schemas ──────────────────────────────

class TeamMemberProfile(BaseModel):
    user_id: UUID
    name: str
    email: str
    open_tasks_count: int = 0
    total_meetings: int = 0
    topics: list[str] = []
    last_active: Optional[datetime] = None

    model_config = {"from_attributes": True}


class PeopleIntelligence(BaseModel):
    user_id: UUID
    name: str
    commitments: list[dict] = []
    expertise_topics: list[str] = []
    meeting_history: list[dict] = []

    model_config = {"from_attributes": True}
