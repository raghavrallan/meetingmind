"""
Seed script: Populates the database with a device user, sample projects, and meetings.

Usage:
    # From the project root (with containers running):
    docker exec -i ai-notetaker-auth-svc-1 python -c "$(cat seed.py)"

    # Or if running outside Docker (needs DATABASE_URL pointing to localhost):
    DATABASE_URL=postgresql+asyncpg://notetaker:notetaker_secret@localhost:5432/ai_notetaker python seed.py
"""

import asyncio
import uuid
from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

# ── Inline config — works both inside Docker and locally ─────────────
import os

DATABASE_URL = os.environ.get(
    "DATABASE_URL",
    "postgresql+asyncpg://notetaker:notetaker_secret@localhost:5432/ai_notetaker",
)


async def seed():
    engine = create_async_engine(DATABASE_URL, echo=False)
    session_factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

    # Import models after engine is ready (they register with Base)
    from shared.database import Base
    from shared.models import (
        User, Project, ProjectMember, Meeting, MeetingParticipant, MeetingNote,
    )
    from shared.models.project import ProjectRole
    from shared.models.meeting import MeetingStatus

    # Create tables if they don't exist
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    async with session_factory() as db:
        # ── Check if already seeded ──────────────────────────────
        result = await db.execute(
            select(User).where(User.email == "agent@local.device")
        )
        if result.scalar_one_or_none():
            print("Database already seeded. Skipping.")
            await engine.dispose()
            return

        now = datetime.now(timezone.utc)

        # ── 1. Create device user ────────────────────────────────
        user = User(
            email="agent@local.device",
            name="Desktop Agent",
            auth_provider="device",
            provider_id="local-device",
        )
        db.add(user)
        await db.flush()
        await db.refresh(user)
        user_id = user.id
        print(f"Created user: {user.name} ({user.email}) — {user_id}")

        # ── 2. Create projects ───────────────────────────────────
        projects_data = [
            {"name": "Product Redesign Q1", "color": "#6366f1", "description": "Q1 product redesign initiative"},
            {"name": "Client Onboarding", "color": "#10b981", "description": "New client onboarding process"},
            {"name": "Engineering Sprint", "color": "#f59e0b", "description": "Bi-weekly engineering sprints"},
            {"name": "Marketing Launch", "color": "#ec4899", "description": "Q1 marketing campaign launch"},
        ]

        project_ids = []
        for pd in projects_data:
            project = Project(
                name=pd["name"],
                color=pd["color"],
                description=pd["description"],
                owner_id=user_id,
            )
            db.add(project)
            await db.flush()
            await db.refresh(project)
            project_ids.append(project.id)

            # Add owner membership
            membership = ProjectMember(
                project_id=project.id,
                user_id=user_id,
                role=ProjectRole.OWNER,
            )
            db.add(membership)
            print(f"  Created project: {project.name} — {project.id}")

        await db.flush()

        # ── 3. Create meetings ───────────────────────────────────
        meetings_data = [
            {
                "title": "Sprint Planning - Q1",
                "project_idx": 0,
                "status": MeetingStatus.COMPLETED,
                "duration": 45 * 60 + 22,
                "offset_hours": 2,
                "participants": ["Alice", "Bob", "Carol", "Dave", "Eve", "Frank"],
                "has_notes": True,
            },
            {
                "title": "Product Design Review",
                "project_idx": 1,
                "status": MeetingStatus.COMPLETED,
                "duration": 32 * 60 + 15,
                "offset_hours": 4,
                "participants": ["Alice", "Bob", "Carol", "Grace"],
                "has_notes": True,
            },
            {
                "title": "Client Sync - Acme Corp",
                "project_idx": 0,
                "status": MeetingStatus.COMPLETED,
                "duration": 28 * 60 + 47,
                "offset_hours": 28,
                "participants": ["Alice", "Heidi", "Ivan"],
                "has_notes": False,
            },
            {
                "title": "Engineering Standup",
                "project_idx": 2,
                "status": MeetingStatus.COMPLETED,
                "duration": 12 * 60 + 5,
                "offset_hours": 26,
                "participants": ["Alice", "Bob", "Carol", "Dave", "Eve", "Frank", "Grace", "Heidi"],
                "has_notes": True,
            },
            {
                "title": "1:1 with Sarah",
                "project_idx": None,
                "status": MeetingStatus.COMPLETED,
                "duration": 25 * 60 + 33,
                "offset_hours": 72,
                "participants": ["Alice", "Sarah"],
                "has_notes": True,
            },
            {
                "title": "Quarterly Business Review",
                "project_idx": 1,
                "status": MeetingStatus.COMPLETED,
                "duration": 75 * 60 + 42,
                "offset_hours": 96,
                "participants": [
                    "Alice", "Bob", "Carol", "Dave", "Eve", "Frank",
                    "Grace", "Heidi", "Ivan", "Judy", "Karl", "Liam",
                ],
                "has_notes": True,
            },
        ]

        for md in meetings_data:
            meeting_start = now - timedelta(hours=md["offset_hours"])
            meeting_end = meeting_start + timedelta(seconds=md["duration"])
            project_id = project_ids[md["project_idx"]] if md["project_idx"] is not None else None

            meeting = Meeting(
                title=md["title"],
                project_id=project_id,
                created_by_id=user_id,
                status=md["status"],
                duration_seconds=md["duration"],
                actual_start=meeting_start,
                actual_end=meeting_end,
                language="en",
            )
            db.add(meeting)
            await db.flush()
            await db.refresh(meeting)

            # Add participants
            for i, name in enumerate(md["participants"]):
                participant = MeetingParticipant(
                    meeting_id=meeting.id,
                    display_name=name,
                    speaker_index=i,
                    channel_index=0 if i == 0 else 1,
                    talk_time_seconds=md["duration"] / len(md["participants"]),
                    word_count=int(md["duration"] / len(md["participants"]) * 2.5),
                )
                db.add(participant)

            # Add notes for meetings that have them
            if md["has_notes"]:
                note = MeetingNote(
                    meeting_id=meeting.id,
                    version=1,
                    executive_summary=f"Meeting: {md['title']}. Key topics discussed with {len(md['participants'])} participants.",
                    key_points=[
                        f"Discussed progress on {md['title'].lower()}",
                        "Reviewed action items from previous meeting",
                        "Aligned on next steps and priorities",
                    ],
                    decisions=[f"Agreed to continue with current approach for {md['title'].lower()}"],
                    action_items=[
                        {"task": "Follow up on discussion points", "assignee": md["participants"][0], "due": "Next meeting"},
                        {"task": "Prepare materials for review", "assignee": md["participants"][1] if len(md["participants"]) > 1 else md["participants"][0], "due": "End of week"},
                    ],
                    open_questions=["Timeline for next milestone?"],
                    topics_discussed=[md["title"].split(" - ")[0], "Status update", "Next steps"],
                    full_notes_markdown=f"# {md['title']}\n\n## Summary\nMeeting with {len(md['participants'])} participants.\n\n## Key Points\n- Progress review\n- Action items\n- Next steps",
                    model_used="claude-sonnet-4-20250514",
                    generation_time_ms=2500,
                    context_chunks_used=0,
                )
                db.add(note)

            print(f"  Created meeting: {md['title']} — {meeting.id}")

        await db.commit()
        print(f"\nSeed complete: 1 user, {len(projects_data)} projects, {len(meetings_data)} meetings")

    await engine.dispose()


if __name__ == "__main__":
    asyncio.run(seed())
