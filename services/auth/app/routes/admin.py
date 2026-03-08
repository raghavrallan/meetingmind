"""Admin API endpoints for platform management."""

from datetime import datetime, timezone, timedelta
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import select, func, case, and_, text
from sqlalchemy.ext.asyncio import AsyncSession

from shared.auth import get_current_user
from shared.credits import add_credits
from shared.database import get_db
from shared.models.user import User
from shared.models.meeting import Meeting
from shared.models.credit_transaction import CreditTransaction
from shared.models.api_usage import ApiUsageLog
from shared.models.platform_key import PlatformKey
from shared.platform_keys import invalidate_cache
from shared.vault import vault_encrypt

router = APIRouter(prefix="/admin", tags=["admin"])


async def _require_admin(current_user: dict, db: AsyncSession) -> User:
    user_id = UUID(current_user["sub"])
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user or not user.is_admin:
        raise HTTPException(status_code=403, detail="Admin access required")
    return user


# ── Platform Stats ───────────────────────────────────────────────────


@router.get("/stats")
async def get_platform_stats(
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await _require_admin(current_user, db)
    now = datetime.now(timezone.utc)
    seven_days_ago = now - timedelta(days=7)

    total_users = (await db.execute(select(func.count(User.id)))).scalar() or 0
    active_users_7d = (await db.execute(
        select(func.count(User.id)).where(User.updated_at >= seven_days_ago)
    )).scalar() or 0
    total_meetings = (await db.execute(select(func.count(Meeting.id)))).scalar() or 0
    total_credits_used = (await db.execute(
        select(func.coalesce(func.sum(ApiUsageLog.credits_used), 0))
    )).scalar() or 0
    total_credits_granted = (await db.execute(
        select(func.coalesce(func.sum(CreditTransaction.amount), 0))
        .where(CreditTransaction.amount > 0)
    )).scalar() or 0
    active_keys = (await db.execute(
        select(func.count(PlatformKey.id)).where(PlatformKey.is_active == True)
    )).scalar() or 0

    return {
        "total_users": total_users,
        "active_users_7d": active_users_7d,
        "total_meetings": total_meetings,
        "total_credits_used": total_credits_used,
        "total_credits_granted": total_credits_granted,
        "active_keys": active_keys,
    }


@router.get("/stats/charts")
async def get_chart_data(
    days: int = Query(default=30, ge=7, le=90),
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await _require_admin(current_user, db)
    since = datetime.now(timezone.utc) - timedelta(days=days)

    # Meetings per day
    meetings_result = await db.execute(
        text("""
            SELECT date_trunc('day', created_at)::date as day, count(*) as count
            FROM meetings WHERE created_at >= :since
            GROUP BY day ORDER BY day
        """),
        {"since": since},
    )
    meetings_per_day = [{"date": str(r.day), "count": r.count} for r in meetings_result]

    # Usage by operation
    usage_result = await db.execute(
        select(ApiUsageLog.operation, func.sum(ApiUsageLog.credits_used).label("total"))
        .where(ApiUsageLog.created_at >= since)
        .group_by(ApiUsageLog.operation)
    )
    usage_by_operation = [{"operation": r.operation, "credits": r.total} for r in usage_result]

    # Users by provider
    provider_result = await db.execute(
        select(User.auth_provider, func.count(User.id).label("count"))
        .group_by(User.auth_provider)
    )
    users_by_provider = [{"provider": r.auth_provider, "count": r.count} for r in provider_result]

    return {
        "meetings_per_day": meetings_per_day,
        "usage_by_operation": usage_by_operation,
        "users_by_provider": users_by_provider,
    }


# ── Users ────────────────────────────────────────────────────────────


@router.get("/users")
async def list_users(
    page: int = Query(default=1, ge=1),
    per_page: int = Query(default=20, ge=1, le=100),
    search: Optional[str] = Query(default=None),
    provider: Optional[str] = Query(default=None),
    is_admin_filter: Optional[bool] = Query(default=None, alias="is_admin"),
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await _require_admin(current_user, db)

    query = select(User)
    count_query = select(func.count(User.id))

    if search:
        like = f"%{search}%"
        query = query.where((User.name.ilike(like)) | (User.email.ilike(like)))
        count_query = count_query.where((User.name.ilike(like)) | (User.email.ilike(like)))
    if provider:
        query = query.where(User.auth_provider == provider)
        count_query = count_query.where(User.auth_provider == provider)
    if is_admin_filter is not None:
        query = query.where(User.is_admin == is_admin_filter)
        count_query = count_query.where(User.is_admin == is_admin_filter)

    total = (await db.execute(count_query)).scalar() or 0
    offset = (page - 1) * per_page
    result = await db.execute(
        query.order_by(User.created_at.desc()).offset(offset).limit(per_page)
    )
    users = result.scalars().all()

    return {
        "users": [
            {
                "id": str(u.id),
                "name": u.name,
                "email": u.email,
                "avatar_url": u.avatar_url,
                "auth_provider": u.auth_provider,
                "credit_balance": u.credit_balance,
                "lifetime_credits": u.lifetime_credits,
                "is_admin": u.is_admin,
                "is_active": u.is_active,
                "created_at": u.created_at.isoformat(),
            }
            for u in users
        ],
        "total": total,
        "page": page,
        "per_page": per_page,
    }


@router.get("/users/{user_id}")
async def get_user_detail(
    user_id: UUID,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await _require_admin(current_user, db)

    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    meeting_count = (await db.execute(
        select(func.count(Meeting.id)).where(Meeting.created_by_id == user_id)
    )).scalar() or 0

    tx_result = await db.execute(
        select(CreditTransaction)
        .where(CreditTransaction.user_id == user_id)
        .order_by(CreditTransaction.created_at.desc())
        .limit(20)
    )
    transactions = [
        {"id": str(t.id), "amount": t.amount, "balance_after": t.balance_after,
         "type": t.type, "description": t.description, "created_at": t.created_at.isoformat()}
        for t in tx_result.scalars().all()
    ]

    usage_result = await db.execute(
        select(ApiUsageLog)
        .where(ApiUsageLog.user_id == user_id)
        .order_by(ApiUsageLog.created_at.desc())
        .limit(20)
    )
    usage = [
        {"id": str(u.id), "operation": u.operation, "provider": u.provider,
         "credits_used": u.credits_used, "created_at": u.created_at.isoformat()}
        for u in usage_result.scalars().all()
    ]

    return {
        "id": str(user.id), "name": user.name, "email": user.email,
        "avatar_url": user.avatar_url, "auth_provider": user.auth_provider,
        "credit_balance": user.credit_balance, "lifetime_credits": user.lifetime_credits,
        "is_admin": user.is_admin, "is_active": user.is_active,
        "created_at": user.created_at.isoformat(), "updated_at": user.updated_at.isoformat(),
        "meeting_count": meeting_count,
        "recent_transactions": transactions,
        "recent_usage": usage,
    }


class UserUpdateRequest(BaseModel):
    is_admin: Optional[bool] = None
    is_active: Optional[bool] = None


@router.patch("/users/{user_id}")
async def update_user(
    user_id: UUID,
    body: UserUpdateRequest,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await _require_admin(current_user, db)

    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    if body.is_admin is not None:
        user.is_admin = body.is_admin
    if body.is_active is not None:
        user.is_active = body.is_active

    user.updated_at = datetime.now(timezone.utc)
    await db.flush()

    return {"id": str(user.id), "is_admin": user.is_admin, "is_active": user.is_active}


# ── Usage Logs ───────────────────────────────────────────────────────


@router.get("/usage")
async def list_usage(
    page: int = Query(default=1, ge=1),
    per_page: int = Query(default=50, ge=1, le=200),
    operation: Optional[str] = Query(default=None),
    provider: Optional[str] = Query(default=None),
    user_id: Optional[UUID] = Query(default=None),
    days: int = Query(default=30, ge=1, le=365),
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await _require_admin(current_user, db)
    since = datetime.now(timezone.utc) - timedelta(days=days)

    query = select(ApiUsageLog).where(ApiUsageLog.created_at >= since)
    count_query = select(func.count(ApiUsageLog.id)).where(ApiUsageLog.created_at >= since)

    if operation:
        query = query.where(ApiUsageLog.operation == operation)
        count_query = count_query.where(ApiUsageLog.operation == operation)
    if provider:
        query = query.where(ApiUsageLog.provider == provider)
        count_query = count_query.where(ApiUsageLog.provider == provider)
    if user_id:
        query = query.where(ApiUsageLog.user_id == user_id)
        count_query = count_query.where(ApiUsageLog.user_id == user_id)

    total = (await db.execute(count_query)).scalar() or 0
    offset = (page - 1) * per_page
    result = await db.execute(
        query.order_by(ApiUsageLog.created_at.desc()).offset(offset).limit(per_page)
    )
    logs = result.scalars().all()

    return {
        "logs": [
            {"id": str(l.id), "user_id": str(l.user_id), "meeting_id": str(l.meeting_id) if l.meeting_id else None,
             "operation": l.operation, "provider": l.provider, "credits_used": l.credits_used,
             "tokens_used": l.tokens_used, "created_at": l.created_at.isoformat()}
            for l in logs
        ],
        "total": total, "page": page, "per_page": per_page,
    }


# ── Meetings ─────────────────────────────────────────────────────────


@router.get("/meetings")
async def list_all_meetings(
    page: int = Query(default=1, ge=1),
    per_page: int = Query(default=20, ge=1, le=100),
    status: Optional[str] = Query(default=None),
    user_id: Optional[UUID] = Query(default=None),
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await _require_admin(current_user, db)

    query = select(Meeting)
    count_query = select(func.count(Meeting.id))

    if status:
        query = query.where(Meeting.status == status)
        count_query = count_query.where(Meeting.status == status)
    if user_id:
        query = query.where(Meeting.created_by_id == user_id)
        count_query = count_query.where(Meeting.created_by_id == user_id)

    total = (await db.execute(count_query)).scalar() or 0
    offset = (page - 1) * per_page
    result = await db.execute(
        query.order_by(Meeting.created_at.desc()).offset(offset).limit(per_page)
    )
    meetings = result.scalars().all()

    return {
        "meetings": [
            {"id": str(m.id), "title": m.title, "status": m.status.value if hasattr(m.status, 'value') else str(m.status),
             "created_by_id": str(m.created_by_id), "duration_seconds": m.duration_seconds,
             "language": m.language, "created_at": m.created_at.isoformat()}
            for m in meetings
        ],
        "total": total, "page": page, "per_page": per_page,
    }


# ── Credit Transactions ──────────────────────────────────────────────


@router.get("/credits/transactions")
async def list_credit_transactions(
    page: int = Query(default=1, ge=1),
    per_page: int = Query(default=50, ge=1, le=200),
    tx_type: Optional[str] = Query(default=None, alias="type"),
    user_id: Optional[UUID] = Query(default=None),
    days: int = Query(default=30, ge=1, le=365),
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await _require_admin(current_user, db)
    since = datetime.now(timezone.utc) - timedelta(days=days)

    query = select(CreditTransaction).where(CreditTransaction.created_at >= since)
    count_query = select(func.count(CreditTransaction.id)).where(CreditTransaction.created_at >= since)

    if tx_type:
        query = query.where(CreditTransaction.type == tx_type)
        count_query = count_query.where(CreditTransaction.type == tx_type)
    if user_id:
        query = query.where(CreditTransaction.user_id == user_id)
        count_query = count_query.where(CreditTransaction.user_id == user_id)

    total = (await db.execute(count_query)).scalar() or 0
    offset = (page - 1) * per_page
    result = await db.execute(
        query.order_by(CreditTransaction.created_at.desc()).offset(offset).limit(per_page)
    )
    txs = result.scalars().all()

    # Summary stats
    total_granted = (await db.execute(
        select(func.coalesce(func.sum(CreditTransaction.amount), 0))
        .where(CreditTransaction.amount > 0, CreditTransaction.created_at >= since)
    )).scalar() or 0
    total_used = (await db.execute(
        select(func.coalesce(func.sum(func.abs(CreditTransaction.amount)), 0))
        .where(CreditTransaction.amount < 0, CreditTransaction.created_at >= since)
    )).scalar() or 0

    return {
        "transactions": [
            {"id": str(t.id), "user_id": str(t.user_id), "amount": t.amount,
             "balance_after": t.balance_after, "type": t.type, "description": t.description,
             "created_at": t.created_at.isoformat()}
            for t in txs
        ],
        "total": total, "page": page, "per_page": per_page,
        "summary": {"total_granted": total_granted, "total_used": total_used},
    }


# ── Platform Keys (moved here from settings to avoid route conflict) ──


class PlatformKeyCreate(BaseModel):
    key_name: str = Field(..., min_length=1, max_length=100)
    value: str = Field(..., min_length=1)
    provider: str = Field(..., min_length=1, max_length=50)


class PlatformKeyResponse(BaseModel):
    id: UUID
    key_name: str
    provider: str
    is_active: bool
    last_rotated_at: Optional[datetime] = None
    created_at: datetime
    updated_at: datetime
    model_config = {"from_attributes": True}


@router.get("/platform-keys", response_model=list[PlatformKeyResponse])
async def list_platform_keys(
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await _require_admin(current_user, db)
    result = await db.execute(select(PlatformKey).order_by(PlatformKey.key_name))
    return [PlatformKeyResponse.model_validate(k) for k in result.scalars().all()]


@router.post("/platform-keys", response_model=PlatformKeyResponse)
async def upsert_platform_key(
    body: PlatformKeyCreate,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    admin = await _require_admin(current_user, db)
    result = await db.execute(select(PlatformKey).where(PlatformKey.key_name == body.key_name))
    existing = result.scalar_one_or_none()
    encrypted = vault_encrypt(body.value)

    if existing:
        existing.encrypted_value = encrypted
        existing.provider = body.provider
        existing.updated_by_id = admin.id
        existing.last_rotated_at = datetime.now(timezone.utc)
        existing.updated_at = datetime.now(timezone.utc)
        await db.flush()
        invalidate_cache(body.key_name)
        return PlatformKeyResponse.model_validate(existing)

    pk = PlatformKey(
        key_name=body.key_name, encrypted_value=encrypted, provider=body.provider,
        is_active=True, created_by_id=admin.id, updated_by_id=admin.id,
    )
    db.add(pk)
    await db.flush()
    await db.refresh(pk)
    invalidate_cache(body.key_name)
    return PlatformKeyResponse.model_validate(pk)


@router.delete("/platform-keys/{key_name}")
async def delete_platform_key(
    key_name: str,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await _require_admin(current_user, db)
    result = await db.execute(select(PlatformKey).where(PlatformKey.key_name == key_name))
    pk = result.scalar_one_or_none()
    if not pk:
        raise HTTPException(status_code=404, detail="Key not found")
    pk.is_active = False
    invalidate_cache(key_name)
    return {"deleted": key_name}


# ── Credit Grant ─────────────────────────────────────────────────────


class CreditGrantRequest(BaseModel):
    user_id: UUID
    amount: int = Field(..., gt=0, le=1_000_000)
    description: Optional[str] = None


@router.post("/credits/grant")
async def grant_credits_admin(
    body: CreditGrantRequest,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await _require_admin(current_user, db)
    new_balance = await add_credits(
        db, body.user_id, body.amount,
        tx_type="admin_grant",
        description=body.description or f"Admin grant: +{body.amount} credits",
    )
    return {"user_id": str(body.user_id), "amount": body.amount, "new_balance": new_balance}
