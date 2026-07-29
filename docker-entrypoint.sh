#!/bin/sh
set -e

mkdir -p /app/data /app/downloads /app/data/cookies

# Ensure SQLite file path exists for Prisma
DB_PATH="${DATABASE_URL#file:}"
DB_DIR=$(dirname "$DB_PATH")
mkdir -p "$DB_DIR"

# Ensure Playwright Chromium is present (path must match PLAYWRIGHT_BROWSERS_PATH)
export PLAYWRIGHT_BROWSERS_PATH="${PLAYWRIGHT_BROWSERS_PATH:-/ms-playwright}"
if ! python3 -c "from playwright.sync_api import sync_playwright; p=sync_playwright().start(); b=p.chromium.launch(headless=True, args=['--no-sandbox','--disable-dev-shm-usage']); b.close(); p.stop()" >/dev/null 2>&1; then
  echo "→ Playwright Chromium missing — installing into ${PLAYWRIGHT_BROWSERS_PATH}..."
  mkdir -p "$PLAYWRIGHT_BROWSERS_PATH"
  python3 -m playwright install chromium || echo "⚠ playwright install failed (deep JS scrape may be unavailable)"
fi

# First ensure physical columns exist (handles volume DBs that got columns via
# db push / manual ALTER before migrate deploy knew about them).
echo "→ Ensuring Download schema columns..."
python3 - <<'PY'
import os, sqlite3, sys
url = os.environ.get("DATABASE_URL", "file:/app/data/prod.db")
path = url[5:] if url.startswith("file:") else url
os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
conn = sqlite3.connect(path)
cur = conn.cursor()
cur.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='Download'")
if not cur.fetchone():
    print("  Download table not present yet")
    conn.close()
    sys.exit(0)
cols = {r[1] for r in cur.execute("PRAGMA table_info(Download)").fetchall()}
alters = []
if "format" not in cols:
    alters.append("ALTER TABLE Download ADD COLUMN format TEXT NOT NULL DEFAULT 'mp4'")
if "resolution" not in cols:
    alters.append("ALTER TABLE Download ADD COLUMN resolution TEXT")
if "stage" not in cols:
    alters.append("ALTER TABLE Download ADD COLUMN stage TEXT NOT NULL DEFAULT 'queued'")
if "stageLabel" not in cols:
    alters.append("ALTER TABLE Download ADD COLUMN stageLabel TEXT NOT NULL DEFAULT 'Queued'")
if "referer" not in cols:
    alters.append("ALTER TABLE Download ADD COLUMN referer TEXT")
if "jobType" not in cols:
    alters.append("ALTER TABLE Download ADD COLUMN jobType TEXT NOT NULL DEFAULT 'hls'")
if "engine" not in cols:
    alters.append("ALTER TABLE Download ADD COLUMN engine TEXT")
if "extractor" not in cols:
    alters.append("ALTER TABLE Download ADD COLUMN extractor TEXT")
if "cookiePath" not in cols:
    alters.append("ALTER TABLE Download ADD COLUMN cookiePath TEXT")
if "playlist" not in cols:
    alters.append("ALTER TABLE Download ADD COLUMN playlist INTEGER NOT NULL DEFAULT 0")
if "ytdlpFormat" not in cols:
    alters.append("ALTER TABLE Download ADD COLUMN ytdlpFormat TEXT")
for sql in alters:
    print(f"  + {sql}")
    cur.execute(sql)
if alters:
    conn.commit()
    print(f"  applied {len(alters)} column(s)")
else:
    print("  schema OK:", sorted(cols))
conn.close()
PY

echo "→ Running Prisma migrations..."
if ! npx prisma migrate deploy; then
  echo "⚠ migrate deploy failed — if columns already exist, mark known migrations applied"
  # Recover from "duplicate column" after columns were added out-of-band
  npx prisma migrate resolve --applied 20260725200000_add_format_stage_resolution 2>/dev/null || true
  npx prisma migrate resolve --applied 20260726120000_add_referer 2>/dev/null || true
  npx prisma migrate resolve --applied 20260726210000_all_video_fields 2>/dev/null || true
  npx prisma migrate deploy || true
fi

echo "→ Syncing Prisma schema to database..."
if ! npx prisma db push --accept-data-loss; then
  echo "⚠ prisma db push failed — trying without accept-data-loss"
  npx prisma db push || echo "⚠ schema sync failed"
fi

echo "→ Ensuring SQLite WAL mode (multi-worker safe)..."
python3 - <<'PY'
import os, sqlite3
from pathlib import Path
url = os.environ.get("DATABASE_URL", "file:/app/data/prod.db")
path = url[5:] if url.startswith("file:") else url
Path(path).parent.mkdir(parents=True, exist_ok=True)
if Path(path).exists():
    c = sqlite3.connect(path, timeout=30)
    mode = c.execute("PRAGMA journal_mode=WAL").fetchone()
    c.execute("PRAGMA busy_timeout=30000")
    c.close()
    print(f"  journal_mode={mode[0] if mode else '?'}")
else:
    print("  db will be created by migrations")
PY

echo "→ Starting Next.js..."
exec "$@"
