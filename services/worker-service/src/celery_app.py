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
        "backfill-tick": {
            "task": "backfill.tick",
            "schedule": 30.0,  # Every 30 seconds
        },
        "backfill-check-budgets": {
            "task": "backfill.check_budgets",
            "schedule": 300.0,  # Every 5 minutes
        },
        "classify-unclassified-nightly": {
            "task": "classification.classify_unclassified_batch",
            "schedule": crontab(hour=3, minute=0),  # 3 AM Manila time
            "kwargs": {"limit": 100},
        },
        # Catches any document that slipped past the inline classify hook
        # in ingestion_tasks.chain_post_ingestion (e.g. backfill imports,
        # failed first run, or the inline task died). Small limit keeps
        # this a cleanup sweep rather than a replacement for inline.
        "classify-unclassified-15min": {
            "task": "classification.classify_unclassified_batch",
            "schedule": 900.0,  # 15 minutes
            "kwargs": {"limit": 10},
        },
        "poll-pending-derivative-jobs": {
            "task": "derivatives.poll_pending_jobs",
            "schedule": 30.0,  # Every 30 seconds
        },
    },
)

# Daily incremental crawls (SCEL + LawPhil). Additive to beat_schedule and
# gated on WORKER_CRAWL_DAILY_ENABLED — both tasks register unconditionally
# but short-circuit to a no-op when the flag is false, so toggling the env
# var is the single switch that enables the schedule in prod.
if settings.crawl_daily_enabled:
    app.conf.beat_schedule.update({
        "crawl.scel_incremental": {
            "task": "ingestion.crawl_scel_since_last",
            "schedule": crontab(hour=2, minute=0),   # 02:00 Asia/Manila
        },
        "crawl.lawphil_incremental": {
            "task": "ingestion.crawl_lawphil_since_last",
            "schedule": crontab(hour=2, minute=30),  # 02:30 Asia/Manila
        },
    })

# Explicit task module registration — autodiscover_tasks looks for a
# `tasks.py` file inside each package, not `*_tasks.py` files, so we
# register every module explicitly.
app.conf.include = [
    "src.tasks.ingestion_tasks",
    "src.tasks.ocr_tasks",
    "src.tasks.embedding_tasks",
    "src.tasks.digest_tasks",
    "src.tasks.digest_generation_tasks",
    "src.tasks.citation_tasks",
    "src.tasks.doctrine_tasks",
    "src.tasks.categorization_tasks",
    "src.tasks.dlq_tasks",
    "src.tasks.backfill_tasks",
    "src.tasks.classification_generation_tasks",
    "src.tasks.doctrine_generation_tasks",
    "src.tasks.mcq_generation_tasks",
    "src.tasks.essay_generation_tasks",
    "src.tasks.flashcard_generation_tasks",
    "src.tasks.outline_generation_tasks",
    "src.tasks.derivative_dispatch_tasks",
    "src.tasks.daily_crawl_tasks",
    "src.tasks.reprocess_tasks",
    "src.tasks.cost_tasks",
]
