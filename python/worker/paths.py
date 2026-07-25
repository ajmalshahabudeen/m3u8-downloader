"""Filename helpers mirroring src/lib/paths.ts (title only, no IDs)."""
from __future__ import annotations

import os
import re
from pathlib import Path

FORMAT_EXT = {
    "mp4": "mp4",
    "mkv": "mkv",
    "ts": "ts",
    "webm": "webm",
    "mov": "mov",
    "mp3": "mp3",
    "m4a": "m4a",
}


def downloads_dir() -> Path:
    raw = os.environ.get("DOWNLOADS_DIR") or "/app/downloads"
    p = Path(raw)
    p.mkdir(parents=True, exist_ok=True)
    return p


def sanitize_file_name(title: str) -> str:
    base = title.strip()
    base = re.sub(r'[<>:"/\\|?*\x00-\x1f]', "", base)
    base = re.sub(r"\s+", " ", base)
    base = re.sub(r"[. ]+$", "", base)
    base = re.sub(r"^\.+", "", base)
    base = base[:180]
    return base if base else "video"


def build_output_path(title: str, fmt: str) -> tuple[str, str]:
    ext = FORMAT_EXT.get((fmt or "mp4").lower().lstrip("."), "mp4")
    base = sanitize_file_name(title)
    directory = downloads_dir()
    file_name = f"{base}.{ext}"
    file_path = directory / file_name
    n = 1
    while file_path.exists():
        file_name = f"{base} ({n}).{ext}"
        file_path = directory / file_name
        n += 1
        if n > 9999:
            break
    return file_name, str(file_path)
