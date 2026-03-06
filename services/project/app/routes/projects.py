from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select, func, delete
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from shared.auth import get_current_user
from shared.database import get_db
from shared.models import Project, ProjectMember, Meeting, User
from shared.models.project import ProjectRole
from services.project.app.models import (
    ProjectCreate,
    ProjectUpdate,
    ProjectResponse,
    ProjectListResponse,
    MemberAdd,
    MemberResponse,
)

router = APIRouter(prefix="/projects", tags=["projects"])


def _project_response(project: Project, member_count: int = 0, meeting_count: int = 0) -> ProjectResponse:
    return ProjectResponse(
        id=project.id,
        name=project.name,
        description=project.description,
        color=project.color,
        is_archived=project.is_archived,
        owner_id=project.owner_id,
        brief=project.brief,
        meeting_count=meeting_count,
        member_count=member_count,
        created_at=project.created_at,
    )


@router.post("/", response_model=ProjectResponse, status_code=status.HTTP_201_CREATED)
async def create_project(
    data: ProjectCreate,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Create a new project. The current user becomes the owner."""
    user_id = UUID(current_user["sub"])

    project = Project(
        name=data.name,
        description=data.description,
        color=data.color,
        owner_id=user_id,
    )
    db.add(project)
    await db.flush()

    # Auto-create owner membership
    membership = ProjectMember(
        project_id=project.id,
        user_id=user_id,
        role=ProjectRole.OWNER,
    )
    db.add(membership)
    await db.flush()

    return _project_response(project, member_count=1, meeting_count=0)


@router.get("/", response_model=ProjectListResponse)
async def list_projects(
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """List all projects where the current user is a member."""
    user_id = UUID(current_user["sub"])

    # Get project IDs for this user
    member_subq = (
        select(ProjectMember.project_id)
        .where(ProjectMember.user_id == user_id)
        .subquery()
    )

    # Fetch projects with counts
    stmt = (
        select(
            Project,
            func.count(func.distinct(ProjectMember.id)).label("member_count"),
            func.count(func.distinct(Meeting.id)).label("meeting_count"),
        )
        .outerjoin(ProjectMember, ProjectMember.project_id == Project.id)
        .outerjoin(Meeting, Meeting.project_id == Project.id)
        .where(Project.id.in_(select(member_subq)))
        .where(Project.is_archived == False)
        .group_by(Project.id)
        .order_by(Project.created_at.desc())
    )

    result = await db.execute(stmt)
    rows = result.all()

    projects = [
        _project_response(row.Project, member_count=row.member_count, meeting_count=row.meeting_count)
        for row in rows
    ]

    return ProjectListResponse(projects=projects, total=len(projects))


@router.get("/{project_id}", response_model=ProjectResponse)
async def get_project(
    project_id: UUID,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Get project detail with brief, member count, and meeting count."""
    user_id = UUID(current_user["sub"])

    # Verify membership
    await _verify_membership(db, project_id, user_id)

    stmt = (
        select(
            Project,
            func.count(func.distinct(ProjectMember.id)).label("member_count"),
            func.count(func.distinct(Meeting.id)).label("meeting_count"),
        )
        .outerjoin(ProjectMember, ProjectMember.project_id == Project.id)
        .outerjoin(Meeting, Meeting.project_id == Project.id)
        .where(Project.id == project_id)
        .group_by(Project.id)
    )

    result = await db.execute(stmt)
    row = result.first()
    if not row:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")

    return _project_response(row.Project, member_count=row.member_count, meeting_count=row.meeting_count)


@router.patch("/{project_id}", response_model=ProjectResponse)
async def update_project(
    project_id: UUID,
    data: ProjectUpdate,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Update project (owner/admin only)."""
    user_id = UUID(current_user["sub"])

    membership = await _verify_membership(db, project_id, user_id)
    if membership.role not in (ProjectRole.OWNER, ProjectRole.ADMIN):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only owner or admin can update the project")

    result = await db.execute(select(Project).where(Project.id == project_id))
    project = result.scalar_one_or_none()
    if not project:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")

    update_data = data.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(project, key, value)
    await db.flush()

    # Fetch counts
    count_stmt = (
        select(
            func.count(func.distinct(ProjectMember.id)).label("member_count"),
            func.count(func.distinct(Meeting.id)).label("meeting_count"),
        )
        .select_from(Project)
        .outerjoin(ProjectMember, ProjectMember.project_id == Project.id)
        .outerjoin(Meeting, Meeting.project_id == Project.id)
        .where(Project.id == project_id)
    )
    count_result = await db.execute(count_stmt)
    counts = count_result.first()

    return _project_response(project, member_count=counts.member_count, meeting_count=counts.meeting_count)


@router.delete("/{project_id}", status_code=status.HTTP_204_NO_CONTENT)
async def archive_project(
    project_id: UUID,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Archive project (owner only)."""
    user_id = UUID(current_user["sub"])

    membership = await _verify_membership(db, project_id, user_id)
    if membership.role != ProjectRole.OWNER:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only the owner can archive the project")

    result = await db.execute(select(Project).where(Project.id == project_id))
    project = result.scalar_one_or_none()
    if not project:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")

    project.is_archived = True
    await db.flush()


@router.post("/{project_id}/members", response_model=MemberResponse, status_code=status.HTTP_201_CREATED)
async def add_member(
    project_id: UUID,
    data: MemberAdd,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Add a member to the project."""
    user_id = UUID(current_user["sub"])

    membership = await _verify_membership(db, project_id, user_id)
    if membership.role not in (ProjectRole.OWNER, ProjectRole.ADMIN):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only owner or admin can add members")

    # Check if target user exists
    user_result = await db.execute(select(User).where(User.id == data.user_id))
    target_user = user_result.scalar_one_or_none()
    if not target_user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    # Check if already a member
    existing = await db.execute(
        select(ProjectMember).where(
            ProjectMember.project_id == project_id,
            ProjectMember.user_id == data.user_id,
        )
    )
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="User is already a member of this project")

    role = ProjectRole(data.role)
    new_member = ProjectMember(
        project_id=project_id,
        user_id=data.user_id,
        role=role,
    )
    db.add(new_member)
    await db.flush()

    return MemberResponse(
        id=new_member.id,
        user_id=target_user.id,
        name=target_user.name,
        email=target_user.email,
        role=new_member.role.value,
        joined_at=new_member.joined_at,
    )


@router.delete("/{project_id}/members/{member_user_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_member(
    project_id: UUID,
    member_user_id: UUID,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Remove a member from the project."""
    user_id = UUID(current_user["sub"])

    membership = await _verify_membership(db, project_id, user_id)
    if membership.role not in (ProjectRole.OWNER, ProjectRole.ADMIN):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only owner or admin can remove members")

    # Cannot remove the owner
    result = await db.execute(select(Project).where(Project.id == project_id))
    project = result.scalar_one_or_none()
    if project and project.owner_id == member_user_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Cannot remove the project owner")

    del_stmt = delete(ProjectMember).where(
        ProjectMember.project_id == project_id,
        ProjectMember.user_id == member_user_id,
    )
    result = await db.execute(del_stmt)
    if result.rowcount == 0:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Member not found")


@router.get("/{project_id}/members", response_model=list[MemberResponse])
async def list_members(
    project_id: UUID,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """List all members of a project."""
    user_id = UUID(current_user["sub"])
    await _verify_membership(db, project_id, user_id)

    stmt = (
        select(ProjectMember, User)
        .join(User, User.id == ProjectMember.user_id)
        .where(ProjectMember.project_id == project_id)
        .order_by(ProjectMember.joined_at)
    )
    result = await db.execute(stmt)
    rows = result.all()

    return [
        MemberResponse(
            id=row.ProjectMember.id,
            user_id=row.User.id,
            name=row.User.name,
            email=row.User.email,
            role=row.ProjectMember.role.value,
            joined_at=row.ProjectMember.joined_at,
        )
        for row in rows
    ]


# ─── Helpers ────────────────────────────────────────────

async def _verify_membership(db: AsyncSession, project_id: UUID, user_id: UUID) -> ProjectMember:
    """Verify the user is a member of the project. Returns the membership."""
    stmt = select(ProjectMember).where(
        ProjectMember.project_id == project_id,
        ProjectMember.user_id == user_id,
    )
    result = await db.execute(stmt)
    membership = result.scalar_one_or_none()
    if not membership:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You are not a member of this project",
        )
    return membership
