import os
from celery import Celery
from celery.schedules import crontab

broker_url = os.getenv("CELERY_BROKER_URL", "redis://redis:6379/1")
result_backend = os.getenv("CELERY_RESULT_BACKEND", "redis://redis:6379/2")

app = Celery(
    "ai_notetaker",
    broker=broker_url,
    backend=result_backend,
    include=[
        "ai_worker",
        "embedding_worker",
        "calendar_worker",
    ],
)

app.conf.update(
    task_serializer="json",
    accept_content=["json"],
    result_serializer="json",
    timezone="UTC",
    enable_utc=True,
    task_track_started=True,
    task_acks_late=True,
    worker_prefetch_multiplier=1,
    task_routes={
        "ai_worker.*": {"queue": "ai"},
        "embedding_worker.*": {"queue": "embeddings"},
        "calendar_worker.*": {"queue": "calendar"},
    },
    beat_schedule={
        "sync-calendars-every-5-minutes": {
            "task": "calendar_worker.sync_all_calendars",
            "schedule": crontab(minute="*/5"),
        },
    },
)
