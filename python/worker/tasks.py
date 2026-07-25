"""Celery tasks — each runs in its own OS process (prefork pool).

Heavy work is always a separate subprocess (download_stream.py / extract_stream.py)
so a hung ffmpeg/Playwright cannot freeze the worker pool permanently.
"""
from __future__ import annotations

import os
import re
import subprocess
import sys
import time
from collections.abc import Callable
from pathlib import Path

from celery.exceptions import SoftTimeLimitExceeded
from celery.utils.log import get_task_logger

from worker.celery_app import app
from worker import db
from worker.paths import build_output_path

log = get_task_logger(__name__)

STAGE_TO_STATUS = {
    "queued": "PENDING",
    "probing": "PROBING",
    "extracting": "EXTRACTING",
    "downloading": "DOWNLOADING",
    "combining": "COMBINING",
    "converting": "CONVERTING",
    "finalizing": "FINALIZING",
    "completed": "COMPLETED",
    "failed": "FAILED",
}

SCRIPTS_DIR = Path(os.environ.get("PYTHON_SCRIPTS_DIR", "/app/python"))
PYTHON_BIN = os.environ.get("PYTHON_BIN", sys.executable or "python3")
DOWNLOADER = (os.environ.get("DOWNLOADER") or "ffmpeg").lower()
DOWNLOAD_TIMEOUT_S = max(
    60, int(os.environ.get("DOWNLOAD_TIMEOUT_MS", "1800000")) // 1000
)


def _script(name: str) -> str:
    p = SCRIPTS_DIR / name
    if not p.exists():
        # fallback next to package
        alt = Path(__file__).resolve().parent.parent / name
        if alt.exists():
            return str(alt)
        raise FileNotFoundError(f"Script not found: {name} ({p})")
    return str(p)


def _run_script(
    script: str,
    args: list[str],
    timeout_s: int,
    on_line: Callable[[str], None] | None = None,
) -> tuple[int, str, str]:
    """Spawn an isolated child process for one job step."""
    cmd = [PYTHON_BIN, script, *args]
    log.info("spawn: %s", " ".join(cmd[:6]) + ("…" if len(cmd) > 6 else ""))
    proc = subprocess.Popen(
        cmd,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        stdin=subprocess.DEVNULL,
        text=True,
        bufsize=1,
        cwd=str(SCRIPTS_DIR),
        env=os.environ.copy(),
    )
    assert proc.stdout is not None and proc.stderr is not None
    stdout_chunks: list[str] = []
    stderr_chunks: list[str] = []
    start = time.time()

    # Non-blocking-ish read loop
    import select

    streams = [proc.stdout, proc.stderr]
    while True:
        if time.time() - start > timeout_s:
            proc.kill()
            try:
                proc.wait(timeout=5)
            except Exception:
                pass
            raise TimeoutError(f"Child timed out after {timeout_s}s: {script}")

        if proc.poll() is not None:
            # drain
            out_rest = proc.stdout.read() or ""
            err_rest = proc.stderr.read() or ""
            if out_rest:
                stdout_chunks.append(out_rest)
            if err_rest:
                stderr_chunks.append(err_rest)
                if on_line:
                    for line in err_rest.splitlines():
                        if line.strip():
                            on_line(line)
            break

        readable, _, _ = select.select(streams, [], [], 0.5)
        for stream in readable:
            line = stream.readline()
            if not line:
                continue
            if stream is proc.stdout:
                stdout_chunks.append(line)
            else:
                stderr_chunks.append(line)
                if on_line and line.strip():
                    on_line(line.rstrip("\n"))

    code = proc.returncode if proc.returncode is not None else -1
    return code, "".join(stdout_chunks), "".join(stderr_chunks)


def _parse_json_stdout(stdout: str) -> dict:
    import json

    text = stdout.strip()
    if not text:
        raise RuntimeError("Python child produced empty stdout")
    lines = [ln.strip() for ln in text.splitlines() if ln.strip()]
    last = lines[-1] if lines else text
    try:
        return json.loads(last)
    except json.JSONDecodeError:
        return json.loads(text)


@app.task(
    name="worker.tasks.run_download",
    bind=True,
    max_retries=2,
    default_retry_delay=15,
    acks_late=True,
    reject_on_worker_lost=True,
)
def run_download(self, download_id: str) -> dict:
    """Process one download job in an isolated worker process."""
    log.info("run_download start id=%s task_id=%s", download_id, self.request.id)

    row = db.get_download(download_id)
    if not row:
        log.warning("download missing id=%s", download_id)
        return {"ok": False, "error": "not_found"}

    # Claim if still pending; allow re-run if already mid-flight from enqueue race
    claimed = db.claim_download(download_id)
    if not claimed:
        status = (row.get("status") or "").upper()
        if status in ("COMPLETED",):
            return {"ok": True, "skipped": True, "reason": "already_completed"}
        if status == "PENDING":
            # lost race — another worker took it
            return {"ok": True, "skipped": True, "reason": "claimed_elsewhere"}
        # FAILED retry or stuck PROBING: take over
        db.force_start(download_id)

    row = db.get_download(download_id) or row
    title = row.get("title") or "video"
    fmt = (row.get("format") or "mp4").lower()
    url = row.get("url") or ""
    referer = (row.get("referer") or "").strip()

    file_name, file_path = build_output_path(title, fmt)
    db.update_download(
        download_id,
        fileName=file_name,
        filePath=file_path,
        status="PROBING",
        stage="probing",
        stageLabel="Probing stream",
        progress=1,
        error=None,
    )

    last_progress = 1

    def on_stderr(line: str) -> None:
        nonlocal last_progress
        m = re.match(r"^STAGE\s+(\S+)\s+(.+)$", line, re.I)
        if m:
            stage = m.group(1).lower()
            label = m.group(2).strip()
            status = STAGE_TO_STATUS.get(stage, "DOWNLOADING")
            try:
                db.update_download(
                    download_id,
                    status=status,
                    stage=stage,
                    stageLabel=label,
                )
            except Exception as e:  # noqa: BLE001
                log.debug("stage update failed: %s", e)
            return
        m = re.match(r"^PROGRESS\s+(\d+)", line, re.I)
        if not m:
            return
        nxt = int(m.group(1))
        if nxt <= last_progress:
            return
        last_progress = nxt
        try:
            db.update_download(download_id, progress=nxt)
        except Exception:
            pass

    prefer = "downloadm3u8" if DOWNLOADER == "downloadm3u8" else "ffmpeg"
    args = [
        "--url",
        url,
        "--output",
        file_path,
        "--format",
        fmt,
        "--prefer",
        prefer,
        "--timeout",
        str(DOWNLOAD_TIMEOUT_S),
    ]
    if referer:
        args.extend(["--referer", referer])

    try:
        code, stdout, stderr = _run_script(
            _script("download_stream.py"),
            args,
            timeout_s=DOWNLOAD_TIMEOUT_S + 30,
            on_line=on_stderr,
        )
        try:
            result = _parse_json_stdout(stdout)
        except Exception as e:
            raise RuntimeError(
                stderr.strip() or f"download_stream.py invalid JSON (exit {code}): {e}"
            ) from e

        if not result.get("ok"):
            raise RuntimeError(result.get("error") or "Download failed")

        path = Path(file_path)
        if not path.exists() or path.stat().st_size <= 0:
            raise RuntimeError("Download finished but output file missing/empty")

        size = int(result.get("fileSize") or path.stat().st_size)
        db.update_download(
            download_id,
            status="COMPLETED",
            stage="completed",
            stageLabel="Completed",
            progress=100,
            fileName=file_name,
            filePath=file_path,
            fileSize=size,
            error=None,
        )
        log.info("run_download done id=%s size=%s", download_id, size)
        return {"ok": True, "filePath": file_path, "fileSize": size}

    except SoftTimeLimitExceeded:
        msg = "Task soft time limit exceeded"
        log.error("run_download timeout id=%s", download_id)
        _fail(download_id, file_path, msg)
        raise
    except Exception as e:  # noqa: BLE001
        msg = str(e)
        log.error("run_download failed id=%s: %s", download_id, msg)
        _fail(download_id, file_path, msg)
        # Retry only transient network-ish errors
        low = msg.lower()
        transient = any(
            x in low
            for x in ("timeout", "ssl", "tls", "connection", "temporarily", "503", "502")
        )
        if transient and self.request.retries < self.max_retries:
            db.update_download(
                download_id,
                status="PENDING",
                stage="queued",
                stageLabel="Retrying…",
                progress=0,
                error=msg,
            )
            raise self.retry(exc=e)
        return {"ok": False, "error": msg}


def _fail(download_id: str, file_path: str, message: str) -> None:
    try:
        p = Path(file_path)
        if p.exists():
            p.unlink(missing_ok=True)
    except Exception:
        pass
    try:
        db.update_download(
            download_id,
            status="FAILED",
            stage="failed",
            stageLabel="Failed",
            progress=0,
            error=message[:2000],
        )
    except Exception as e:  # noqa: BLE001
        log.error("failed to mark FAILED id=%s: %s", download_id, e)


@app.task(
    name="worker.tasks.run_extract",
    bind=True,
    max_retries=2,
    default_retry_delay=10,
    acks_late=True,
    reject_on_worker_lost=True,
)
def run_extract(self, url: str, deep: bool = True) -> dict:
    """Optional async extract — isolated Playwright/static scrape process."""
    args = ["--url", url]
    if deep:
        args.append("--deep")
    try:
        code, stdout, stderr = _run_script(
            _script("extract_stream.py"),
            args,
            timeout_s=150,
            on_line=None,
        )
        result = _parse_json_stdout(stdout)
        if result.get("error"):
            raise RuntimeError(result["error"])
        return {"ok": True, "result": result, "code": code}
    except Exception as e:  # noqa: BLE001
        low = str(e).lower()
        if any(x in low for x in ("ssl", "tls", "timeout", "connection")):
            if self.request.retries < self.max_retries:
                raise self.retry(exc=e)
        return {"ok": False, "error": str(e), "stderr": ""}


@app.task(name="worker.tasks.requeue_stale_pending")
def requeue_stale_pending(limit: int = 50) -> dict:
    """Safety net: enqueue any PENDING rows left in SQLite (e.g. after crash)."""
    from worker.celery_app import app as celery_app

    ids = db.list_pending_ids(limit=limit)
    for i in ids:
        celery_app.send_task(
            "worker.tasks.run_download",
            args=[i],
            queue="downloads",
        )
    return {"enqueued": len(ids), "ids": ids}
