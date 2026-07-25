#!/usr/bin/env python3
"""Enqueue jobs onto Redis/Celery from the Next.js API or CLI.

Usage:
  python enqueue_job.py --type download --id <cuid>
  python enqueue_job.py --type download --id a --id b
  python enqueue_job.py --type extract --url https://...
  python enqueue_job.py --type requeue-pending
"""
from __future__ import annotations

import argparse
import json
import os
import sys

# Ensure /app/python is on path when run as script
_HERE = os.path.dirname(os.path.abspath(__file__))
if _HERE not in sys.path:
    sys.path.insert(0, _HERE)


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--type", required=True, choices=("download", "extract", "requeue-pending"))
    p.add_argument("--id", action="append", default=[], dest="ids")
    p.add_argument("--url", default="")
    p.add_argument("--deep", action="store_true", default=True)
    p.add_argument("--no-deep", action="store_true")
    args = p.parse_args()

    # Import after path fix
    from worker.celery_app import app

    deep = False if args.no_deep else True

    try:
        # Fail fast if Redis is down
        conn = app.connection()
        conn.ensure_connection(max_retries=3)
        conn.release()
    except Exception as e:  # noqa: BLE001
        print(json.dumps({"ok": False, "error": f"Redis/broker unavailable: {e}"}))
        raise SystemExit(2)

    if args.type == "download":
        if not args.ids:
            print(json.dumps({"ok": False, "error": "Provide at least one --id"}))
            raise SystemExit(1)
        task_ids = []
        for did in args.ids:
            async_result = app.send_task(
                "worker.tasks.run_download",
                args=[did],
                queue="downloads",
            )
            task_ids.append({"downloadId": did, "taskId": async_result.id})
        print(json.dumps({"ok": True, "type": "download", "tasks": task_ids}))
        return

    if args.type == "extract":
        if not args.url.strip():
            print(json.dumps({"ok": False, "error": "--url required"}))
            raise SystemExit(1)
        async_result = app.send_task(
            "worker.tasks.run_extract",
            args=[args.url.strip(), deep],
            queue="extracts",
        )
        print(
            json.dumps(
                {
                    "ok": True,
                    "type": "extract",
                    "taskId": async_result.id,
                }
            )
        )
        return

    if args.type == "requeue-pending":
        async_result = app.send_task(
            "worker.tasks.requeue_stale_pending",
            queue="downloads",
        )
        print(json.dumps({"ok": True, "type": "requeue-pending", "taskId": async_result.id}))
        return


if __name__ == "__main__":
    main()
