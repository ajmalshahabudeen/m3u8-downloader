"""SQLite helpers for Celery workers (same Prisma Download table)."""
from __future__ import annotations

import os
import sqlite3
import time
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Iterator


def database_path() -> str:
    url = os.environ.get("DATABASE_URL", "file:/app/data/prod.db")
    if url.startswith("file:"):
        path = url[5:]
        if path.startswith("./") or (path and not path.startswith("/") and ":" not in path[:2]):
            base = Path(os.environ.get("APP_ROOT", "/app"))
            path = str((base / path.lstrip("./")).resolve())
        return path
    return url


def _ts() -> str:
    # Prisma DateTime as ISO-8601 UTC
    return time.strftime("%Y-%m-%dT%H:%M:%S.000Z", time.gmtime())


@contextmanager
def connect() -> Iterator[sqlite3.Connection]:
    path = database_path()
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(path, timeout=60, isolation_level=None)
    conn.row_factory = sqlite3.Row
    try:
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA busy_timeout=30000")
        conn.execute("PRAGMA synchronous=NORMAL")
        yield conn
    finally:
        conn.close()


def get_download(download_id: str) -> dict[str, Any] | None:
    with connect() as conn:
        row = conn.execute(
            'SELECT * FROM "Download" WHERE id = ?', (download_id,)
        ).fetchone()
        return dict(row) if row else None


def claim_download(download_id: str) -> bool:
    """Atomically move PENDING → PROBING. False if already claimed."""
    with connect() as conn:
        cur = conn.execute(
            """
            UPDATE "Download"
            SET status = 'PROBING',
                stage = 'probing',
                stageLabel = 'Starting…',
                progress = 1,
                error = NULL,
                updatedAt = ?
            WHERE id = ? AND status = 'PENDING'
            """,
            (_ts(), download_id),
        )
        return cur.rowcount == 1


def force_start(download_id: str) -> None:
    """Mark job started even if not PENDING (retry path)."""
    with connect() as conn:
        conn.execute(
            """
            UPDATE "Download"
            SET status = 'PROBING',
                stage = 'probing',
                stageLabel = 'Starting…',
                progress = 1,
                error = NULL,
                updatedAt = ?
            WHERE id = ?
            """,
            (_ts(), download_id),
        )


def update_download(download_id: str, **fields: Any) -> None:
    if not fields:
        return
    allowed = {
        "status",
        "stage",
        "stageLabel",
        "progress",
        "fileName",
        "filePath",
        "fileSize",
        "error",
    }
    cols: list[str] = []
    vals: list[Any] = []
    for k, v in fields.items():
        if k not in allowed:
            continue
        cols.append(f'"{k}" = ?')
        vals.append(v)
    if not cols:
        return
    cols.append('"updatedAt" = ?')
    vals.append(_ts())
    vals.append(download_id)
    sql = f'UPDATE "Download" SET {", ".join(cols)} WHERE id = ?'
    with connect() as conn:
        conn.execute(sql, vals)


def list_pending_ids(limit: int = 50) -> list[str]:
    with connect() as conn:
        rows = conn.execute(
            """
            SELECT id FROM "Download"
            WHERE status = 'PENDING'
            ORDER BY createdAt ASC
            LIMIT ?
            """,
            (limit,),
        ).fetchall()
        return [r["id"] for r in rows]
