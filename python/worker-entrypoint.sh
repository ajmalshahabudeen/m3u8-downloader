#!/bin/sh
# Celery worker entry — process-isolated prefork pool
set -e

mkdir -p /app/data /app/downloads

export PYTHONPATH="${PYTHON_SCRIPTS_DIR:-/app/python}:${PYTHONPATH:-}"
export PLAYWRIGHT_BROWSERS_PATH="${PLAYWRIGHT_BROWSERS_PATH:-/ms-playwright}"
export APP_ROOT="${APP_ROOT:-/app}"

# Wait for Redis
echo "→ Waiting for Redis at ${REDIS_URL:-redis://redis:6379/0}…"
python3 - <<'PY'
import os, time, sys
url = os.environ.get("REDIS_URL", "redis://redis:6379/0")
try:
    import redis
    # celery redis URL
    from urllib.parse import urlparse
    u = urlparse(url)
    host = u.hostname or "redis"
    port = u.port or 6379
    db = int((u.path or "/0").lstrip("/") or "0")
    r = redis.Redis(host=host, port=port, db=db, socket_connect_timeout=2)
    for i in range(60):
        try:
            if r.ping():
                print("  redis ok")
                sys.exit(0)
        except Exception as e:
            print(f"  wait {i+1}: {e}")
            time.sleep(1)
    print("Redis not ready", file=sys.stderr)
    sys.exit(1)
except Exception as e:
    print("redis check failed", e, file=sys.stderr)
    sys.exit(1)
PY

# Ensure SQLite WAL for multi-worker writers
python3 - <<'PY'
import os, sqlite3
from pathlib import Path
url = os.environ.get("DATABASE_URL", "file:/app/data/prod.db")
path = url[5:] if url.startswith("file:") else url
Path(path).parent.mkdir(parents=True, exist_ok=True)
if Path(path).exists():
    c = sqlite3.connect(path, timeout=30)
    c.execute("PRAGMA journal_mode=WAL")
    c.execute("PRAGMA busy_timeout=30000")
    c.close()
    print("  sqlite WAL enabled")
else:
    print("  db not created yet (app will migrate)")
PY

CONCURRENCY="${WORKER_CONCURRENCY:-3}"
QUEUES="${CELERY_QUEUES:-downloads,extracts}"

echo "→ Starting Celery worker concurrency=${CONCURRENCY} queues=${QUEUES}"
cd "${PYTHON_SCRIPTS_DIR:-/app/python}"

# Prefork = one OS process per concurrent task (true isolation)
exec celery -A worker.celery_app worker \
  --loglevel="${CELERY_LOGLEVEL:-INFO}" \
  --concurrency="${CONCURRENCY}" \
  --pool=prefork \
  --queues="${QUEUES}" \
  --hostname="worker@%h" \
  --max-tasks-per-child="${WORKER_MAX_TASKS_PER_CHILD:-25}" \
  --without-gossip \
  --without-mingle \
  --without-heartbeat
