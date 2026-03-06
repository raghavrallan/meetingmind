from pydantic_settings import BaseSettings
from functools import lru_cache


class Settings(BaseSettings):
    # Database
    database_url: str = "postgresql+asyncpg://notetaker:notetaker_secret@postgres:5432/ai_notetaker"

    # Redis
    redis_url: str = "redis://redis:6379/0"

    # Auth
    jwt_secret: str = "your-jwt-secret-change-me"
    jwt_algorithm: str = "HS256"
    jwt_expiration_minutes: int = 1440

    # OAuth - Google
    google_client_id: str = ""
    google_client_secret: str = ""

    # OAuth - Microsoft
    microsoft_client_id: str = ""
    microsoft_client_secret: str = ""
    microsoft_tenant_id: str = "common"

    # AI / Transcription
    deepgram_api_key: str = ""
    anthropic_api_key: str = ""
    openai_api_key: str = ""

    # MinIO
    minio_endpoint: str = "minio:9000"
    minio_access_key: str = "minioadmin"
    minio_secret_key: str = "minioadmin_secret"
    minio_bucket: str = "meeting-audio"

    # Celery
    celery_broker_url: str = "redis://redis:6379/1"
    celery_result_backend: str = "redis://redis:6379/2"

    model_config = {"env_file": ".env", "extra": "ignore"}


@lru_cache
def get_settings() -> Settings:
    return Settings()
