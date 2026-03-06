"""User Settings API — encrypted storage for API keys and preferences."""

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select, delete
from sqlalchemy.ext.asyncio import AsyncSession

from shared.auth import get_current_user
from shared.database import get_db
from shared.encryption import encrypt_value, decrypt_value, mask_value
from shared.models.user_setting import UserSetting

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
