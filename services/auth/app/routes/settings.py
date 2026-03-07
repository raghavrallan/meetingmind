"""User Settings + Admin Platform Key Management API."""

from datetime import datetime, timezone
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import select, delete, func
from sqlalchemy.ext.asyncio import AsyncSession

from shared.auth import get_current_user
from shared.credits import add_credits
from shared.database import get_db
from shared.encryption import encrypt_value, decrypt_value, mask_value
from shared.models.user import User
from shared.models.user_setting import UserSetting
from shared.models.platform_key import PlatformKey
from shared.models.credit_transaction import CreditTransaction
from shared.models.api_usage import ApiUsageLog
from shared.platform_keys import invalidate_cache
from shared.vault import vault_encrypt, vault_decrypt

router = APIRouter(prefix="/settings", tags=["settings"])

# ─── Allowed setting keys (whitelist) ─────────────────
ALLOWED_KEYS = {
    # AI / Transcription
    "deepgram_api_key": {"category": "api_keys", "label": "Deepgram API Key"},
    "anthropic_api_key": {"category": "api_keys", "label": "Anthropic API Key"},
    "openai_api_key": {"category": "api_keys", "label": "OpenAI API Key"},
    # OAuth (for personal calendar access)
    "google_client_id": {"category": "oauth", "label": "Google Client ID"},
    "google_client_secret": {"category": "oauth", "label": "Google Client Secret"},
    "microsoft_client_id": {"category": "oauth", "label": "Microsoft Client ID"},
    "microsoft_client_secret": {"category": "oauth", "label": "Microsoft Client Secret"},
    "microsoft_tenant_id": {"category": "oauth", "label": "Microsoft Tenant ID"},
    # Preferences
    "preferred_language": {"category": "preferences", "label": "Preferred Language"},
    "timezone": {"category": "preferences", "label": "Timezone"},
}


# ─── Schemas ──────────────────────────────────────────
class SettingUpsert(BaseModel):
    key: str
    value: str


class SettingBatchUpsert(BaseModel):
    settings: list[SettingUpsert]


class SettingResponse(BaseModel):
    key: str
    masked_value: str
    has_value: bool
    category: str
    label: str
    updated_at: str | None = None


class SettingsListResponse(BaseModel):
    settings: list[SettingResponse]


# ─── Routes ──────────────────────────────────────────

@router.get("/", response_model=SettingsListResponse)
async def list_settings(
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """List all settings for the current user. Values are masked."""
    user_id = UUID(user["sub"])

    result = await db.execute(
        select(UserSetting).where(UserSetting.user_id == user_id)
    )
    saved = {s.setting_key: s for s in result.scalars().all()}

    settings = []
    for key, meta in ALLOWED_KEYS.items():
        if key in saved:
            decrypted = decrypt_value(saved[key].encrypted_value)
            settings.append(SettingResponse(
                key=key,
                masked_value=mask_value(decrypted),
                has_value=True,
                category=meta["category"],
                label=meta["label"],
                updated_at=saved[key].updated_at.isoformat() if saved[key].updated_at else None,
            ))
        else:
            settings.append(SettingResponse(
                key=key,
                masked_value="",
                has_value=False,
                category=meta["category"],
                label=meta["label"],
            ))

    return SettingsListResponse(settings=settings)


@router.put("/")
async def upsert_settings(
    body: SettingBatchUpsert,
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Create or update multiple settings at once. Values are encrypted before storage."""
    user_id = UUID(user["sub"])
    updated = []

    for item in body.settings:
        if item.key not in ALLOWED_KEYS:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Unknown setting key: {item.key}",
            )

        # Skip empty values
        if not item.value.strip():
            continue

        # Skip if value is all bullets (masked — user didn't change it)
        if all(c == "\u2022" for c in item.value):
            continue

        encrypted = encrypt_value(item.value.strip())
        category = ALLOWED_KEYS[item.key]["category"]

        # Upsert
        result = await db.execute(
            select(UserSetting).where(
                UserSetting.user_id == user_id,
                UserSetting.setting_key == item.key,
            )
        )
        existing = result.scalar_one_or_none()

        if existing:
            existing.encrypted_value = encrypted
            existing.category = category
        else:
            setting = UserSetting(
                user_id=user_id,
                setting_key=item.key,
                encrypted_value=encrypted,
                category=category,
            )
            db.add(setting)

        updated.append(item.key)

    await db.flush()
    return {"updated": updated, "count": len(updated)}


@router.get("/{key}")
async def get_setting(
    key: str,
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Get a single setting. Value is masked."""
    if key not in ALLOWED_KEYS:
        raise HTTPException(status_code=400, detail=f"Unknown setting key: {key}")

    user_id = UUID(user["sub"])
    result = await db.execute(
        select(UserSetting).where(
            UserSetting.user_id == user_id,
            UserSetting.setting_key == key,
        )
    )
    setting = result.scalar_one_or_none()

    meta = ALLOWED_KEYS[key]
    if not setting:
        return SettingResponse(
            key=key, masked_value="", has_value=False,
            category=meta["category"], label=meta["label"],
        )

    decrypted = decrypt_value(setting.encrypted_value)
    return SettingResponse(
        key=key,
        masked_value=mask_value(decrypted),
        has_value=True,
        category=meta["category"],
        label=meta["label"],
        updated_at=setting.updated_at.isoformat() if setting.updated_at else None,
    )


@router.delete("/{key}")
async def delete_setting(
    key: str,
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Delete a single setting."""
    user_id = UUID(user["sub"])
    await db.execute(
        delete(UserSetting).where(
            UserSetting.user_id == user_id,
            UserSetting.setting_key == key,
        )
    )
    return {"deleted": key}


@router.get("/raw/{key}")
async def get_setting_raw(
    key: str,
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Get the raw (decrypted) value of a setting. Used internally by other services."""
    if key not in ALLOWED_KEYS:
        raise HTTPException(status_code=400, detail=f"Unknown setting key: {key}")

    user_id = UUID(user["sub"])
    result = await db.execute(
        select(UserSetting).where(
            UserSetting.user_id == user_id,
            UserSetting.setting_key == key,
        )
    )
    setting = result.scalar_one_or_none()
    if not setting:
        return {"key": key, "value": None}

    return {"key": key, "value": decrypt_value(setting.encrypted_value)}


# ═══════════════════════════════════════════════════════════════════════
# Admin-only endpoints for platform key vault and credit management
# ═══════════════════════════════════════════════════════════════════════


async def _require_admin(current_user: dict, db: AsyncSession) -> User:
    user_id = UUID(current_user["sub"])
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user or not user.is_admin:
        raise HTTPException(status_code=403, detail="Admin access required")
    return user


# ── Platform Keys ────────────────────────────────────────────────────


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
    """List all platform keys (admin only). Values are never exposed."""
    await _require_admin(current_user, db)
    result = await db.execute(select(PlatformKey).order_by(PlatformKey.key_name))
    return [PlatformKeyResponse.model_validate(k) for k in result.scalars().all()]


@router.post("/platform-keys", response_model=PlatformKeyResponse)
async def upsert_platform_key(
    body: PlatformKeyCreate,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Create or update a platform key (admin only)."""
    admin = await _require_admin(current_user, db)

    result = await db.execute(
        select(PlatformKey).where(PlatformKey.key_name == body.key_name)
    )
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
        key_name=body.key_name,
        encrypted_value=encrypted,
        provider=body.provider,
        is_active=True,
        created_by_id=admin.id,
        updated_by_id=admin.id,
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
    """Deactivate a platform key (admin only)."""
    await _require_admin(current_user, db)
    result = await db.execute(
        select(PlatformKey).where(PlatformKey.key_name == key_name)
    )
    pk = result.scalar_one_or_none()
    if not pk:
        raise HTTPException(status_code=404, detail="Key not found")
    pk.is_active = False
    invalidate_cache(key_name)
    return {"deleted": key_name}


# ── Credit Management ────────────────────────────────────────────────


class CreditGrantRequest(BaseModel):
    user_id: UUID
    amount: int = Field(..., gt=0, le=1_000_000)
    description: Optional[str] = None


@router.post("/admin/credits/grant")
async def grant_credits(
    body: CreditGrantRequest,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Grant credits to a user (admin only)."""
    await _require_admin(current_user, db)
    new_balance = await add_credits(
        db, body.user_id, body.amount,
        tx_type="admin_grant",
        description=body.description or f"Admin grant: +{body.amount} credits",
    )
    return {"user_id": str(body.user_id), "amount": body.amount, "new_balance": new_balance}


@router.get("/admin/credits/{user_id}")
async def get_user_credits(
    user_id: UUID,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Get a user's credit balance and recent transactions (admin only)."""
    await _require_admin(current_user, db)
    result = await db.execute(
        select(User.credit_balance, User.lifetime_credits).where(User.id == user_id)
    )
    row = result.one_or_none()
    if not row:
        raise HTTPException(status_code=404, detail="User not found")

    tx_result = await db.execute(
        select(CreditTransaction)
        .where(CreditTransaction.user_id == user_id)
        .order_by(CreditTransaction.created_at.desc())
        .limit(20)
    )
    transactions = [
        {
            "id": str(t.id),
            "amount": t.amount,
            "balance_after": t.balance_after,
            "type": t.type,
            "description": t.description,
            "created_at": t.created_at.isoformat(),
        }
        for t in tx_result.scalars().all()
    ]

    return {
        "user_id": str(user_id),
        "credit_balance": row.credit_balance,
        "lifetime_credits": row.lifetime_credits,
        "recent_transactions": transactions,
    }
