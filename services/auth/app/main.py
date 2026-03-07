import logging
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import select

from shared.database import create_tables, async_session
from shared.models.platform_key import PlatformKey
from shared.vault import vault_encrypt

from .routes.admin import router as admin_router
from .routes.auth import router as auth_router
from .routes.calendar import router as calendar_router
from .routes.settings import router as settings_router

logger = logging.getLogger(__name__)

_SEED_KEYS = {
    "deepgram": "DEEPGRAM_API_KEY",
    "anthropic": "ANTHROPIC_API_KEY",
    "openai": "OPENAI_API_KEY",
}


async def _seed_platform_keys():
    """Seed platform_keys table from env vars on first boot."""
    async with async_session() as db:
        result = await db.execute(select(PlatformKey.id).limit(1))
        if result.scalar_one_or_none() is not None:
            return

        seeded = 0
        for key_name, env_var in _SEED_KEYS.items():
            value = os.getenv(env_var, "")
            if value:
                pk = PlatformKey(
                    key_name=key_name,
                    encrypted_value=vault_encrypt(value),
                    provider=key_name,
                    is_active=True,
                )
                db.add(pk)
                seeded += 1

        if seeded:
            await db.commit()
            logger.info(f"Seeded {seeded} platform keys from env vars")


@asynccontextmanager
async def lifespan(app: FastAPI):
    await create_tables()
    await _seed_platform_keys()
    yield


app = FastAPI(
    title="AI Notetaker - Auth Service",
    description="Authentication and calendar integration service",
    version="1.0.0",
    lifespan=lifespan,
)

# CORS middleware — explicit origins required when allow_credentials=True
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://localhost",
        "http://127.0.0.1:3000",
        "http://127.0.0.1",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Mount routes
app.include_router(auth_router)
app.include_router(calendar_router)
app.include_router(settings_router)
app.include_router(admin_router)


@app.get("/health")
async def health_check():
    return {"status": "healthy", "service": "auth"}
