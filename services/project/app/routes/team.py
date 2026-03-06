from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select, func, case, and_
from sqlalchemy.ext.asyncio import AsyncSession

from shared.auth import get_current_user
from shared.database import get_db
from shared.models import (
    Project,
    ProjectMember,
    User,
    Task,
    Meeting,
    MeetingParticipant,
    MeetingNote,
)
from shared.models.task import TaskStatus
from services.project.app.models import TeamMemberProfile

router = APIRouter(prefix="/team", tags=["team"])


@router.get("/", response_model=list[TeamMemberProfile])
async def list_team_members(
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """List all team members across the current user's projects (deduplicated)."""
    user_id = UUID(current_user["sub"])

    # Get project IDs where the current user is a member
    user_project_ids = (
        select(ProjectMember.project_id)
        .where(ProjectMember.user_id == user_id)
        .subquery()
    )

    # Get distinct user IDs from those projects (excluding current user)
    team_user_ids = (
        select(ProjectMember.user_id)
        .where(
            ProjectMember.project_id.in_(select(user_project_ids)),
            ProjectMember.user_id != user_id,
        )
        .distinct()
        .subquery()
    )

    # Fetch user details with open task count
    stmt = (
        select(
            User,
            func.count(
                func.distinct(
                    case(
                        (Task.status.in_([TaskStatus.OPEN, TaskStatus.IN_PROGRESS]), Task.id),
                        else_=None,
                    )
                )
            ).label("open_tasks_count"),
        )
        .outerjoin(Task, Task.assignee_id == User.id)
        .where(User.id.in_(select(team_user_ids)))
        .group_by(User.id)
        .order_by(User.name)
    )

    result = await db.execute(stmt)
    rows = result.all()

    profiles = []
    for row in rows:
        user = row.User

        # Get meeting count for this user
        meeting_stmt = (
            select(func.count(func.distinct(MeetingParticipant.meeting_id)))
            .where(MeetingParticipant.user_id == user.id)
        )
        meeting_result = await db.execute(meeting_stmt)
        total_meetings = meeting_result.scalar() or 0

        # Get topics from meeting notes in shared projects
        topics_stmt = (
            select(MeetingNote.topics_discussed)
            .join(Meeting, Meeting.id == MeetingNote.meeting_id)
            .join(MeetingParticipant, and_(
                MeetingParticipant.meeting_id == Meeting.id,
                MeetingParticipant.user_id == user.id,
            ))
            .where(Meeting.project_id.in_(select(user_project_ids)))
            .where(MeetingNote.topics_discussed.isnot(None))
            .order_by(MeetingNote.created_at.desc())
            .limit(10)
        )
        topics_result = await db.execute(topics_stmt)
        topics_rows = topics_result.scalars().all()

        # Flatten topics
        topics = []
        for topic_list in topics_rows:
            if topic_list:
                for t in topic_list:
                    topic_name = t.get("topic", "") if isinstance(t, dict) else str(t)
                    if topic_name and topic_name not in topics:
                        topics.append(topic_name)
        topics = topics[:10]  # Limit to 10 topics

        # Last active: most recent meeting or task update
        last_active = user.updated_at

        profiles.append(TeamMemberProfile(
            user_id=user.id,
            name=user.name,
            email=user.email,
            open_tasks_count=row.open_tasks_count,
            total_meetings=total_meetings,
            topics=topics,
            last_active=last_active,
        ))

    return profiles


@router.get("/{target_user_id}/profile", response_model=TeamMemberProfile)
async def get_team_member_profile(
    target_user_id: UUID,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Get a team member's resource profile: open tasks, topics, last activity."""
    user_id = UUID(current_user["sub"])

    # Verify that the target user shares at least one project with current user
    shared_projects = (
        select(ProjectMember.project_id)
        .where(ProjectMember.user_id == user_id)
        .intersect(
            select(ProjectMember.project_id)
            .where(ProjectMember.user_id == target_user_id)
        )
        .subquery()
    )

    check = await db.execute(select(func.count()).select_from(shared_projects))
    if check.scalar() == 0:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You do not share any projects with this user",
        )

    # Fetch user
    user_result = await db.execute(select(User).where(User.id == target_user_id))
    target_user = user_result.scalar_one_or_none()
    if not target_user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    # Open tasks count
    task_stmt = select(func.count(Task.id)).where(
        Task.assignee_id == target_user_id,
        Task.status.in_([TaskStatus.OPEN, TaskStatus.IN_PROGRESS]),
    )
    task_result = await db.execute(task_stmt)
    open_tasks_count = task_result.scalar() or 0

    # Total meetings
    meeting_stmt = select(func.count(func.distinct(MeetingParticipant.meeting_id))).where(
        MeetingParticipant.user_id == target_user_id,
    )
    meeting_result = await db.execute(meeting_stmt)
    total_meetings = meeting_result.scalar() or 0

    # Topics from meeting notes
    user_project_ids = (
        select(ProjectMember.project_id).where(ProjectMember.user_id == user_id).subquery()
    )
    topics_stmt = (
        select(MeetingNote.topics_discussed)
        .join(Meeting, Meeting.id == MeetingNote.meeting_id)
        .join(MeetingParticipant, and_(
            MeetingParticipant.meeting_id == Meeting.id,
            MeetingParticipant.user_id == target_user_id,
        ))
        .where(Meeting.project_id.in_(select(user_project_ids)))
        .where(MeetingNote.topics_discussed.isnot(None))
        .order_by(MeetingNote.created_at.desc())
        .limit(10)
    )
    topics_result = await db.execute(topics_stmt)
    topics_rows = topics_result.scalars().all()

    topics = []
    for topic_list in topics_rows:
        if topic_list:
            for t in topic_list:
                topic_name = t.get("topic", "") if isinstance(t, dict) else str(t)
                if topic_name and topic_name not in topics:
                    topics.append(topic_name)
    topics = topics[:10]

    return TeamMemberProfile(
        user_id=target_user.id,
        name=target_user.name,
        email=target_user.email,
        open_tasks_count=open_tasks_count,
        total_meetings=total_meetings,
        topics=topics,
        last_active=target_user.updated_at,
    )


@router.get("/{target_user_id}/workload")
async def get_team_member_workload(
    target_user_id: UUID,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Get workload view: tasks by status, upcoming deadlines."""
    user_id = UUID(current_user["sub"])

    # Verify shared projects
    shared_projects = (
        select(ProjectMember.project_id)
        .where(ProjectMember.user_id == user_id)
        .intersect(
            select(ProjectMember.project_id)
            .where(ProjectMember.user_id == target_user_id)
        )
        .subquery()
    )

    check = await db.execute(select(func.count()).select_from(shared_projects))
    if check.scalar() == 0:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You do not share any projects with this user",
        )

    # Tasks by status
    status_stmt = (
        select(Task.status, func.count(Task.id))
        .where(Task.assignee_id == target_user_id)
        .group_by(Task.status)
    )
    status_result = await db.execute(status_stmt)
    tasks_by_status = {row[0].value: row[1] for row in status_result.all()}

    # Upcoming deadlines (next 14 days)
    from datetime import date, timedelta

    today = date.today()
    deadline_limit = today + timedelta(days=14)

    deadline_stmt = (
        select(Task)
        .where(
            Task.assignee_id == target_user_id,
            Task.due_date.isnot(None),
            Task.due_date >= today,
            Task.due_date <= deadline_limit,
            Task.status.in_([TaskStatus.OPEN, TaskStatus.IN_PROGRESS]),
        )
        .order_by(Task.due_date)
    )
    deadline_result = await db.execute(deadline_stmt)
    upcoming_tasks = deadline_result.scalars().all()

    upcoming_deadlines = [
        {
            "task_id": str(task.id),
            "title": task.title,
            "due_date": task.due_date.isoformat() if task.due_date else None,
            "priority": task.priority.value,
            "status": task.status.value,
            "project_id": str(task.project_id) if task.project_id else None,
        }
        for task in upcoming_tasks
    ]

    return {
        "user_id": str(target_user_id),
        "tasks_by_status": tasks_by_status,
        "upcoming_deadlines": upcoming_deadlines,
    }
