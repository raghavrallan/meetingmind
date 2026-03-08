"""Platform key vault — centralized API key access with in-memory cache.

All services call get_platform_key("deepgram") instead of reading env vars.
Keys are stored AES-256-GCM encrypted in the platform_keys table.
"""

import logging
import os
import time
from typing import Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from shared.models.platform_key import PlatformKey
from shared.vault import vault_decrypt

logger = logging.getLogger(__name__)

_cache: dict[str, tuple[str, float]] = {}
_CACHE_TTL = 300  # 5 minutes

_ENV_FALLBACKS = {
    "deepgram": "DEEPGRAM_API_KEY",
    "anthropic": "ANTHROPIC_API_KEY",
    "openai": "OPENAI_API_KEY",
}


async def get_platform_key(db: AsyncSession, key_name: str) -> Optional[str]:
    """Get a decrypted platform API key.

    Lookup order:
    1. In-memory cache (5-min TTL)
    2. platform_keys DB table (AES-256-GCM encrypted)
    3. Environment variable fallback (legacy)
    """
    now = time.time()
    if key_name in _cache:
        value, expires_at = _cache[key_name]
        if now < expires_at:
            return value

    try:
        result = await db.execute(
            select(PlatformKey.encrypted_value)
            .where(PlatformKey.key_name == key_name, PlatformKey.is_active == True)
        )
        row = result.scalar_one_or_none()
        if row:
            decrypted = vault_decrypt(row)
            _cache[key_name] = (decrypted, now + _CACHE_TTL)
            return decrypted
    except Exception as e:
        logger.warning(f"Failed to read platform key '{key_name}' from DB: {e}")

    env_var = _ENV_FALLBACKS.get(key_name)
    if env_var:
        val = os.getenv(env_var, "")
        if val:
            _cache[key_name] = (val, now + _CACHE_TTL)
            return val

    return None


def invalidate_cache(key_name: Optional[str] = None) -> None:
    """Clear cached keys. Call after admin updates a key."""
    if key_name:
        _cache.pop(key_name, None)
    else:
        _cache.clear()
