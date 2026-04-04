"""LIBERTASIAN Worker Service — Celery application configuration."""

from celery import Celery
from celery.schedules import crontab  # noqa: F401 — used implicitly by beat_schedule

from .config import settings

app = Celery(
    "libertasian-worker",
    broker=settings.redis_url,
    backend=settings.celery_result_backend,
)

app.conf.update(
    task_serializer="json",
    accept_content=["json"],
    result_serializer="json",
    timezone="Asia/Manila",
    enable_utc=True,
    task_acks_late=True,
    worker_reject_on_worker_lost=True,
    task_track_started=True,
    broker_transport_options={
        "queue_order_strategy": "priority",
    },
    # Celery key prefix to avoid collision with NestJS BullMQ
    result_backend_transport_options={
        "global_keyprefix": "celery:",
    },
    # Task routing — dead-letter tasks go to a dedicated queue
    task_routes={
        "ingestion.handle_dead_letter": {"queue": "dead_letter"},
    },
    # Celery Beat schedule for periodic tasks
    beat_schedule={
        "poll-pending-ingestion-jobs": {
            "task": "ingestion.poll_pending_jobs",
            "schedule": 60.0,  # Every 60 seconds
        },
    },
)

# Register task modules (autodiscovers all @shared_task in src/tasks/*.py
# including: ingestion, OCR, doctrine, citation, categorization,
# digest, DLQ, and embedding tasks)
app.autodiscover_tasks(["src.tasks"])
