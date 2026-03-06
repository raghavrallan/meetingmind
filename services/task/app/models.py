from datetime import date, datetime
from typing import Optional
from uuid import UUID

from pydantic import BaseModel, Field


# ─── Task Schemas ────────────────────────────────────────

class TaskCreate(BaseModel):
    title: str = Field(..., min_length=1, max_length=500)
    description: Optional[str] = None
    priority: str = Field(default="medium", pattern=r"^(low|medium|high|urgent)$")
    assignee_id: Optional[UUID] = None
    project_id: Optional[UUID] = None
    source_meeting_id: Optional[UUID] = None
    due_date: Optional[date] = None


class TaskUpdate(BaseModel):
    title: Optional[str] = Field(default=None, min_length=1, max_length=500)
    description: Optional[str] = None
    status: Optional[str] = Field(default=None, pattern=r"^(open|in_progress|completed|cancelled)$")
    priority: Optional[str] = Field(default=None, pattern=r"^(low|medium|high|urgent)$")
    assignee_id: Optional[UUID] = None
    due_date: Optional[date] = None


class TaskResponse(BaseModel):
    id: UUID
    title: str
    description: Optional[str] = None
    status: str
    priority: str
    assignee_id: Optional[UUID] = None
    assignee_name: Optional[str] = None
    project_id: Optional[UUID] = None
    source_meeting_id: Optional[UUID] = None
    due_date: Optional[date] = None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class TaskListResponse(BaseModel):
    tasks: list[TaskResponse]
    total: int


class TaskBoardResponse(BaseModel):
    open: list[TaskResponse] = []
    in_progress: list[TaskResponse] = []
    completed: list[TaskResponse] = []
    cancelled: list[TaskResponse] = []


class LifecycleEvent(BaseModel):
    task_id: UUID
    event_type: str
    details: Optional[str] = None
    timestamp: datetime
