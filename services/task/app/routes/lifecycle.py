from datetime import date, datetime, timedelta, timezone
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select, func, and_
from sqlalchemy.ext.asyncio import AsyncSession

from shared.auth import get_current_user
from shared.database import get_db
from shared.models import Task, User, Project, ProjectMember
from shared.models.task import TaskStatus
from services.task.app.models import TaskResponse

router = APIRouter(prefix="/lifecycle", tags=["lifecycle"])


def _task_response(task: Task, assignee_name: Optional[str] = None) -> TaskResponse:
    return TaskResponse(
        id=task.id,
        title=task.title,
        description=task.description,
        status=task.status.value,
        priority=task.priority.value,
        assignee_id=task.assignee_id,
        assignee_name=assignee_name,
        project_id=task.project_id,
        source_meeting_id=task.source_meeting_id,
        due_date=task.due_date,
        created_at=task.created_at,
        updated_at=task.updated_at,
    )


@router.get("/resurface/{project_id}")
async def get_resurfaceable_tasks(
    project_id: UUID,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Get unresolved tasks for a project that should be resurfaced in the next meeting.
    Returns open/in_progress tasks that haven't been resurfaced recently.
    """
    user_id = UUID(current_user["sub"])

    # Verify membership
    result = await db.execute(
        select(ProjectMember).where(
            ProjectMember.project_id == project_id,
            ProjectMember.user_id == user_id,
        )
    )
    if not result.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You are not a member of this project",
        )

    # Tasks that are open or in_progress, from this project
    # Prioritize: tasks not resurfaced recently (or never resurfaced)
    three_days_ago = datetime.now(timezone.utc) - timedelta(days=3)

    stmt = (
        select(Task, User.name.label("assignee_name"))
        .outerjoin(User, User.id == Task.assignee_id)
        .where(
            Task.project_id == project_id,
            Task.status.in_([TaskStatus.OPEN, TaskStatus.IN_PROGRESS]),
            # Not resurfaced in the last 3 days
            (Task.last_resurfaced_at.is_(None)) | (Task.last_resurfaced_at < three_days_ago),
        )
        .order_by(
            Task.priority.desc(),
            Task.due_date.asc().nullslast(),
            Task.created_at.asc(),
        )
    )

    result = await db.execute(stmt)
    rows = result.all()

    tasks = []
    for row in rows:
        task_data = _task_response(row.Task, assignee_name=row.assignee_name).model_dump(mode="json")
        task_data["resurface_count"] = row.Task.resurface_count
        task_data["last_resurfaced_at"] = row.Task.last_resurfaced_at.isoformat() if row.Task.last_resurfaced_at else None
        tasks.append(task_data)

    return {
        "project_id": str(project_id),
        "total": len(tasks),
        "tasks": tasks,
    }


@router.post("/resurface/{task_id}", status_code=status.HTTP_200_OK)
async def mark_task_resurfaced(
    task_id: UUID,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Mark a task as resurfaced. Updates last_resurfaced_at and increments count."""
    user_id = UUID(current_user["sub"])

    result = await db.execute(select(Task).where(Task.id == task_id))
    task = result.scalar_one_or_none()
    if not task:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Task not found")

    # Verify access through project membership
    if task.project_id:
        member_result = await db.execute(
            select(ProjectMember).where(
                ProjectMember.project_id == task.project_id,
                ProjectMember.user_id == user_id,
            )
        )
        if not member_result.scalar_one_or_none():
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You are not a member of this project",
            )

    task.last_resurfaced_at = datetime.now(timezone.utc)
    task.resurface_count = (task.resurface_count or 0) + 1
    await db.flush()

    return {
        "task_id": str(task.id),
        "resurface_count": task.resurface_count,
        "last_resurfaced_at": task.last_resurfaced_at.isoformat(),
    }


@router.get("/deadlines")
async def get_upcoming_deadlines(
    days: int = Query(default=7, ge=1, le=30),
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Get tasks approaching deadline, grouped by project."""
    user_id = UUID(current_user["sub"])

    today = date.today()
    deadline_limit = today + timedelta(days=days)

    # Get user's project IDs
    user_project_ids = (
        select(ProjectMember.project_id)
        .where(ProjectMember.user_id == user_id)
        .subquery()
    )

    stmt = (
        select(Task, User.name.label("assignee_name"), Project.name.label("project_name"))
        .outerjoin(User, User.id == Task.assignee_id)
        .outerjoin(Project, Project.id == Task.project_id)
        .where(
            Task.due_date.isnot(None),
            Task.due_date >= today,
            Task.due_date <= deadline_limit,
            Task.status.in_([TaskStatus.OPEN, TaskStatus.IN_PROGRESS]),
            # User has access (project member, assignee, or creator)
            (
                Task.project_id.in_(select(user_project_ids))
                | (Task.assignee_id == user_id)
                | (Task.created_by_id == user_id)
            ),
        )
        .order_by(Task.due_date.asc(), Task.priority.desc())
    )

    result = await db.execute(stmt)
    rows = result.all()

    # Group by project
    by_project: dict[str, dict] = {}
    for row in rows:
        project_key = str(row.Task.project_id) if row.Task.project_id else "unassigned"
        if project_key not in by_project:
            by_project[project_key] = {
                "project_id": project_key if project_key != "unassigned" else None,
                "project_name": row.project_name or "Unassigned",
                "tasks": [],
            }
        by_project[project_key]["tasks"].append(
            _task_response(row.Task, assignee_name=row.assignee_name).model_dump(mode="json")
        )

    return {
        "deadline_within_days": days,
        "total": len(rows),
        "by_project": list(by_project.values()),
    }


@router.get("/overdue")
async def get_overdue_tasks(
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Get overdue tasks (past due_date, still open/in_progress)."""
    user_id = UUID(current_user["sub"])

    today = date.today()

    user_project_ids = (
        select(ProjectMember.project_id)
        .where(ProjectMember.user_id == user_id)
        .subquery()
    )

    stmt = (
        select(Task, User.name.label("assignee_name"), Project.name.label("project_name"))
        .outerjoin(User, User.id == Task.assignee_id)
        .outerjoin(Project, Project.id == Task.project_id)
        .where(
            Task.due_date.isnot(None),
            Task.due_date < today,
            Task.status.in_([TaskStatus.OPEN, TaskStatus.IN_PROGRESS]),
            (
                Task.project_id.in_(select(user_project_ids))
                | (Task.assignee_id == user_id)
                | (Task.created_by_id == user_id)
            ),
        )
        .order_by(Task.due_date.asc(), Task.priority.desc())
    )

    result = await db.execute(stmt)
    rows = result.all()

    tasks = []
    for row in rows:
        task_data = _task_response(row.Task, assignee_name=row.assignee_name).model_dump(mode="json")
        task_data["project_name"] = row.project_name
        task_data["days_overdue"] = (today - row.Task.due_date).days
        tasks.append(task_data)

    return {
        "total": len(tasks),
        "tasks": tasks,
    }
