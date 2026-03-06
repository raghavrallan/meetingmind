from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select, func, and_
from sqlalchemy.ext.asyncio import AsyncSession

from shared.auth import get_current_user
from shared.database import get_db
from shared.models import (
    User,
    Task,
    Meeting,
    MeetingParticipant,
    MeetingNote,
    ProjectMember,
)
from shared.models.task import TaskStatus
from services.project.app.models import PeopleIntelligence

router = APIRouter(prefix="/people", tags=["people"])


@router.get("/{target_user_id}/intelligence", response_model=PeopleIntelligence)
async def get_people_intelligence(
    target_user_id: UUID,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Get people intelligence for a user.
    Aggregates: commitments from action items, expertise from frequently owned topics,
    meeting participation history.
    """
    user_id = UUID(current_user["sub"])

    # Verify shared project access
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

    # ─── Commitments: unresolved action items (open/in_progress tasks from meetings) ───
    commitments_stmt = (
        select(Task)
        .where(
            Task.assignee_id == target_user_id,
            Task.source_meeting_id.isnot(None),
            Task.status.in_([TaskStatus.OPEN, TaskStatus.IN_PROGRESS]),
        )
        .order_by(Task.created_at.desc())
        .limit(50)
    )
    commitments_result = await db.execute(commitments_stmt)
    commitment_tasks = commitments_result.scalars().all()

    commitments = [
        {
            "task_id": str(t.id),
            "title": t.title,
            "status": t.status.value,
            "priority": t.priority.value,
            "due_date": t.due_date.isoformat() if t.due_date else None,
            "source_meeting_id": str(t.source_meeting_id) if t.source_meeting_id else None,
            "created_at": t.created_at.isoformat(),
        }
        for t in commitment_tasks
    ]

    # ─── Expertise topics: from meeting notes where user participated ───
    topics_stmt = (
        select(MeetingNote.topics_discussed)
        .join(Meeting, Meeting.id == MeetingNote.meeting_id)
        .join(MeetingParticipant, and_(
            MeetingParticipant.meeting_id == Meeting.id,
            MeetingParticipant.user_id == target_user_id,
        ))
        .where(MeetingNote.topics_discussed.isnot(None))
        .order_by(MeetingNote.created_at.desc())
        .limit(30)
    )
    topics_result = await db.execute(topics_stmt)
    topics_rows = topics_result.scalars().all()

    # Count topic frequency
    topic_counts: dict[str, int] = {}
    for topic_list in topics_rows:
        if topic_list:
            for t in topic_list:
                topic_name = t.get("topic", "") if isinstance(t, dict) else str(t)
                if topic_name:
                    topic_counts[topic_name] = topic_counts.get(topic_name, 0) + 1

    # Sort by frequency, take top 15
    expertise_topics = sorted(topic_counts.keys(), key=lambda k: topic_counts[k], reverse=True)[:15]

    # ─── Meeting history: recent meetings the user participated in ───
    history_stmt = (
        select(Meeting)
        .join(MeetingParticipant, and_(
            MeetingParticipant.meeting_id == Meeting.id,
            MeetingParticipant.user_id == target_user_id,
        ))
        .order_by(Meeting.created_at.desc())
        .limit(20)
    )
    history_result = await db.execute(history_stmt)
    meetings = history_result.scalars().all()

    meeting_history = [
        {
            "meeting_id": str(m.id),
            "title": m.title,
            "project_id": str(m.project_id) if m.project_id else None,
            "status": m.status.value,
            "date": m.created_at.isoformat(),
            "duration_seconds": m.duration_seconds,
        }
        for m in meetings
    ]

    return PeopleIntelligence(
        user_id=target_user.id,
        name=target_user.name,
        commitments=commitments,
        expertise_topics=expertise_topics,
        meeting_history=meeting_history,
    )


@router.get("/{target_user_id}/commitments")
async def get_user_commitments(
    target_user_id: UUID,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    List all open commitments: unresolved action items across meetings
    for a given user.
    """
    user_id = UUID(current_user["sub"])

    # Verify shared project access
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

    # Get all open/in_progress tasks from meetings
    stmt = (
        select(Task, Meeting.title.label("meeting_title"))
        .outerjoin(Meeting, Meeting.id == Task.source_meeting_id)
        .where(
            Task.assignee_id == target_user_id,
            Task.status.in_([TaskStatus.OPEN, TaskStatus.IN_PROGRESS]),
        )
        .order_by(Task.due_date.asc().nullslast(), Task.created_at.desc())
    )
    result = await db.execute(stmt)
    rows = result.all()

    commitments = [
        {
            "task_id": str(row.Task.id),
            "title": row.Task.title,
            "description": row.Task.description,
            "status": row.Task.status.value,
            "priority": row.Task.priority.value,
            "due_date": row.Task.due_date.isoformat() if row.Task.due_date else None,
            "source_meeting_id": str(row.Task.source_meeting_id) if row.Task.source_meeting_id else None,
            "meeting_title": row.meeting_title,
            "project_id": str(row.Task.project_id) if row.Task.project_id else None,
            "created_at": row.Task.created_at.isoformat(),
            "resurface_count": row.Task.resurface_count,
        }
        for row in rows
    ]

    return {
        "user_id": str(target_user_id),
        "name": target_user.name,
        "total": len(commitments),
        "commitments": commitments,
    }
