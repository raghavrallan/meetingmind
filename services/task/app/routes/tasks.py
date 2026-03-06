from datetime import datetime, timezone
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select, func, or_
from sqlalchemy.ext.asyncio import AsyncSession

from shared.auth import get_current_user
from shared.database import get_db
from shared.models import Task, User, ProjectMember
from shared.models.task import TaskStatus, TaskPriority
from services.task.app.models import (
    TaskCreate,
    TaskUpdate,
    TaskResponse,
    TaskListResponse,
    TaskBoardResponse,
)

router = APIRouter(prefix="/tasks", tags=["tasks"])


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


async def _get_assignee_name(db: AsyncSession, assignee_id: Optional[UUID]) -> Optional[str]:
    if not assignee_id:
        return None
    result = await db.execute(select(User.name).where(User.id == assignee_id))
    return result.scalar_one_or_none()


async def _verify_task_access(db: AsyncSession, user_id: UUID, task: Task) -> None:
    """Verify user has access to the task via project membership or being the assignee/creator."""
    if task.created_by_id == user_id or task.assignee_id == user_id:
        return
    if task.project_id:
        result = await db.execute(
            select(ProjectMember).where(
                ProjectMember.project_id == task.project_id,
                ProjectMember.user_id == user_id,
            )
        )
        if result.scalar_one_or_none():
            return
    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail="You do not have access to this task",
    )


@router.post("/", response_model=TaskResponse, status_code=status.HTTP_201_CREATED)
async def create_task(
    data: TaskCreate,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Create a new task."""
    user_id = UUID(current_user["sub"])

    # If project_id provided, verify membership
    if data.project_id:
        result = await db.execute(
            select(ProjectMember).where(
                ProjectMember.project_id == data.project_id,
                ProjectMember.user_id == user_id,
            )
        )
        if not result.scalar_one_or_none():
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You are not a member of this project",
            )

    task = Task(
        title=data.title,
        description=data.description,
        priority=TaskPriority(data.priority),
        assignee_id=data.assignee_id,
        project_id=data.project_id,
        source_meeting_id=data.source_meeting_id,
        due_date=data.due_date,
        created_by_id=user_id,
    )
    db.add(task)
    await db.flush()

    assignee_name = await _get_assignee_name(db, task.assignee_id)
    return _task_response(task, assignee_name=assignee_name)


@router.get("/board/", response_model=TaskBoardResponse)
async def get_task_board(
    project_id: Optional[UUID] = Query(default=None),
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Get Kanban board view: tasks grouped by status."""
    user_id = UUID(current_user["sub"])

    stmt = (
        select(Task, User.name.label("assignee_name"))
        .outerjoin(User, User.id == Task.assignee_id)
    )

    if project_id:
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
        stmt = stmt.where(Task.project_id == project_id)
    else:
        # Get tasks from all user's projects + tasks assigned to or created by user
        user_project_ids = (
            select(ProjectMember.project_id)
            .where(ProjectMember.user_id == user_id)
            .subquery()
        )
        stmt = stmt.where(
            or_(
                Task.project_id.in_(select(user_project_ids)),
                Task.assignee_id == user_id,
                Task.created_by_id == user_id,
            )
        )

    stmt = stmt.order_by(Task.created_at.desc())
    result = await db.execute(stmt)
    rows = result.all()

    board = TaskBoardResponse()
    for row in rows:
        task_resp = _task_response(row.Task, assignee_name=row.assignee_name)
        status_value = row.Task.status.value
        if status_value == "open":
            board.open.append(task_resp)
        elif status_value == "in_progress":
            board.in_progress.append(task_resp)
        elif status_value == "completed":
            board.completed.append(task_resp)
        elif status_value == "cancelled":
            board.cancelled.append(task_resp)

    return board


@router.get("/", response_model=TaskListResponse)
async def list_tasks(
    project_id: Optional[UUID] = Query(default=None),
    assignee_id: Optional[UUID] = Query(default=None),
    task_status: Optional[str] = Query(default=None, alias="status"),
    priority: Optional[str] = Query(default=None),
    sort_by: str = Query(default="created_at", pattern=r"^(created_at|due_date|priority|updated_at)$"),
    sort_order: str = Query(default="desc", pattern=r"^(asc|desc)$"),
    offset: int = Query(default=0, ge=0),
    limit: int = Query(default=50, ge=1, le=100),
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """List tasks with filters, pagination, and sorting."""
    user_id = UUID(current_user["sub"])

    base_stmt = select(Task, User.name.label("assignee_name")).outerjoin(User, User.id == Task.assignee_id)

    # Filter by project or default to accessible tasks
    if project_id:
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
        base_stmt = base_stmt.where(Task.project_id == project_id)
    else:
        user_project_ids = (
            select(ProjectMember.project_id)
            .where(ProjectMember.user_id == user_id)
            .subquery()
        )
        base_stmt = base_stmt.where(
            or_(
                Task.project_id.in_(select(user_project_ids)),
                Task.assignee_id == user_id,
                Task.created_by_id == user_id,
            )
        )

    # Apply filters
    if assignee_id:
        base_stmt = base_stmt.where(Task.assignee_id == assignee_id)
    if task_status:
        base_stmt = base_stmt.where(Task.status == TaskStatus(task_status))
    if priority:
        base_stmt = base_stmt.where(Task.priority == TaskPriority(priority))

    # Count total
    count_stmt = select(func.count()).select_from(base_stmt.subquery())
    total_result = await db.execute(count_stmt)
    total = total_result.scalar() or 0

    # Apply sorting
    sort_column = getattr(Task, sort_by)
    if sort_order == "desc":
        base_stmt = base_stmt.order_by(sort_column.desc())
    else:
        base_stmt = base_stmt.order_by(sort_column.asc())

    # Apply pagination
    base_stmt = base_stmt.offset(offset).limit(limit)

    result = await db.execute(base_stmt)
    rows = result.all()

    tasks = [_task_response(row.Task, assignee_name=row.assignee_name) for row in rows]
    return TaskListResponse(tasks=tasks, total=total)


@router.get("/{task_id}", response_model=TaskResponse)
async def get_task(
    task_id: UUID,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Get task detail."""
    user_id = UUID(current_user["sub"])

    result = await db.execute(select(Task).where(Task.id == task_id))
    task = result.scalar_one_or_none()
    if not task:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Task not found")

    await _verify_task_access(db, user_id, task)

    assignee_name = await _get_assignee_name(db, task.assignee_id)
    return _task_response(task, assignee_name=assignee_name)


@router.patch("/{task_id}", response_model=TaskResponse)
async def update_task(
    task_id: UUID,
    data: TaskUpdate,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Update a task. If status changes to completed, set completed_at."""
    user_id = UUID(current_user["sub"])

    result = await db.execute(select(Task).where(Task.id == task_id))
    task = result.scalar_one_or_none()
    if not task:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Task not found")

    await _verify_task_access(db, user_id, task)

    update_data = data.model_dump(exclude_unset=True)

    # Handle status change
    if "status" in update_data:
        new_status = TaskStatus(update_data["status"])
        update_data["status"] = new_status
        if new_status == TaskStatus.COMPLETED and task.status != TaskStatus.COMPLETED:
            task.completed_at = datetime.now(timezone.utc)
        elif new_status != TaskStatus.COMPLETED:
            task.completed_at = None

    # Handle priority change
    if "priority" in update_data:
        update_data["priority"] = TaskPriority(update_data["priority"])

    for key, value in update_data.items():
        setattr(task, key, value)

    await db.flush()

    assignee_name = await _get_assignee_name(db, task.assignee_id)
    return _task_response(task, assignee_name=assignee_name)


@router.delete("/{task_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_task(
    task_id: UUID,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Delete a task."""
    user_id = UUID(current_user["sub"])

    result = await db.execute(select(Task).where(Task.id == task_id))
    task = result.scalar_one_or_none()
    if not task:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Task not found")

    await _verify_task_access(db, user_id, task)
    await db.delete(task)
    await db.flush()


@router.post("/batch", response_model=list[TaskResponse], status_code=status.HTTP_201_CREATED)
async def batch_create_tasks(
    tasks_data: list[TaskCreate],
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Create multiple tasks at once (for AI-extracted action items)."""
    user_id = UUID(current_user["sub"])

    # Verify project membership for all unique project IDs
    project_ids = {t.project_id for t in tasks_data if t.project_id}
    for pid in project_ids:
        result = await db.execute(
            select(ProjectMember).where(
                ProjectMember.project_id == pid,
                ProjectMember.user_id == user_id,
            )
        )
        if not result.scalar_one_or_none():
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"You are not a member of project {pid}",
            )

    created_tasks = []
    for data in tasks_data:
        task = Task(
            title=data.title,
            description=data.description,
            priority=TaskPriority(data.priority),
            assignee_id=data.assignee_id,
            project_id=data.project_id,
            source_meeting_id=data.source_meeting_id,
            due_date=data.due_date,
            created_by_id=user_id,
        )
        db.add(task)
        created_tasks.append(task)

    await db.flush()

    # Fetch assignee names in bulk
    assignee_ids = {t.assignee_id for t in created_tasks if t.assignee_id}
    assignee_names: dict[UUID, str] = {}
    if assignee_ids:
        name_result = await db.execute(
            select(User.id, User.name).where(User.id.in_(assignee_ids))
        )
        assignee_names = {row.id: row.name for row in name_result.all()}

    return [
        _task_response(task, assignee_name=assignee_names.get(task.assignee_id))
        for task in created_tasks
    ]
