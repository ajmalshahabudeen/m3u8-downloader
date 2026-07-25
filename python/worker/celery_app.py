"""Celery application — Redis broker, prefork process pool (isolation per task)."""
from __future__ import annotations

import os

from celery import Celery

REDIS_URL = os.environ.get("REDIS_URL", "redis://127.0.0.1:6379/0")

app = Celery(
    "m3u8_downloader",
    broker=REDIS_URL,
    backend=REDIS_URL,
    include=["worker.tasks"],
)

# High-grade defaults: late ack, reject on worker loss, recycle children, hard limits
app.conf.update(
    task_serializer="json",
    accept_content=["json"],
    result_serializer="json",
    timezone="UTC",
    enable_utc=True,
    # Each task is acked only after success/failure — crash mid-job requeues
    task_acks_late=True,
    task_reject_on_worker_lost=True,
    # Prefork: true OS process per concurrent slot (not threads)
    worker_prefetch_multiplier=1,
    worker_max_tasks_per_child=int(os.environ.get("WORKER_MAX_TASKS_PER_CHILD", "25")),
    # Soft limit → SoftTimeLimitExceeded; hard → kill process
    task_soft_time_limit=int(os.environ.get("TASK_SOFT_TIME_LIMIT", "1800")),
    task_time_limit=int(os.environ.get("TASK_TIME_LIMIT", "1900")),
    broker_connection_retry_on_startup=True,
    broker_transport_options={
        "visibility_timeout": int(os.environ.get("TASK_TIME_LIMIT", "1900")) + 120,
    },
    result_expires=86400,
    task_default_queue="downloads",
    task_routes={
        "worker.tasks.run_download": {"queue": "downloads"},
        "worker.tasks.run_extract": {"queue": "extracts"},
        "worker.tasks.requeue_stale_pending": {"queue": "downloads"},
    },
    task_track_started=True,
)
