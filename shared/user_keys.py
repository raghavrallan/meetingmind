"""Helper to retrieve decrypted user API keys from the database.

Services call `get_user_key(db, user_id, "deepgram_api_key")` to get the user's
stored key. Falls back to the environment variable if no DB entry exists.
"""

import os
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from shared.encryption import decrypt_value
from shared.models.user_setting import UserSetting

# Mapping from setting_key to the env var fallback
_ENV_FALLBACKS = {
    "deepgram_api_key": "DEEPGRAM_API_KEY",
    "anthropic_api_key": "ANTHROPIC_API_KEY",
    "openai_api_key": "OPENAI_API_KEY",
    "google_client_id": "GOOGLE_CLIENT_ID",
    "google_client_secret": "GOOGLE_CLIENT_SECRET",
    "microsoft_client_id": "MICROSOFT_CLIENT_ID",
    "microsoft_client_secret": "MICROSOFT_CLIENT_SECRET",
    "microsoft_tenant_id": "MICROSOFT_TENANT_ID",
}


async def get_user_key(db: AsyncSession, user_id: UUID, key: str) -> str | None:
    """Get a decrypted user setting value. Falls back to env var if not in DB."""
    result = await db.execute(
        select(UserSetting.encrypted_value).where(
            UserSetting.user_id == user_id,
            UserSetting.setting_key == key,
        )
    )
    row = result.scalar_one_or_none()
    if row:
        return decrypt_value(row)

    # Fallback to env var
    env_var = _ENV_FALLBACKS.get(key)
    if env_var:
        val = os.getenv(env_var, "")
        return val if val else None

    return None


async def get_user_keys(db: AsyncSession, user_id: UUID, keys: list[str]) -> dict[str, str | None]:
    """Get multiple decrypted user settings at once."""
    result = await db.execute(
        select(UserSetting.setting_key, UserSetting.encrypted_value).where(
            UserSetting.user_id == user_id,
            UserSetting.setting_key.in_(keys),
        )
    )
    rows = {row.setting_key: decrypt_value(row.encrypted_value) for row in result.all()}

    out = {}
    for key in keys:
        if key in rows:
            out[key] = rows[key]
        else:
            env_var = _ENV_FALLBACKS.get(key)
            val = os.getenv(env_var, "") if env_var else ""
            out[key] = val if val else None

    return out
