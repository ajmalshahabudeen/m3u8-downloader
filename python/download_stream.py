#!/usr/bin/env python3
"""Download HLS and convert to the requested format with stage reporting.

Usage:
  python download_stream.py --url URL --output /path/out.mp4 --format mp4

Stderr protocol:
  STAGE <code> <human label>
  PROGRESS <0-99>
Stdout: JSON result
"""
from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path

PROGRESS_RE = re.compile(r"(\d{1,3})%")
TIME_RE = re.compile(r"time=(\d+):(\d+):(\d+(?:\.\d+)?)")
DURATION_RE = re.compile(r"Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)")

# formats that typically need re-encode rather than stream copy
REENCODE_FORMATS = {"webm", "mp3", "m4a"}
AUDIO_ONLY = {"mp3", "m4a"}


def which(name: str) -> str | None:
    return shutil.which(name)


def find_ffmpeg() -> str | None:
    env = os.environ.get("FFMPEG_BIN")
    if env and Path(env).exists():
        return env
    return which("ffmpeg")


def find_downloadm3u8() -> str | None:
    env = os.environ.get("DOWNLOADM3U8_BIN")
    if env and Path(env).exists():
        return env
    for c in (
        Path.home() / ".local" / "bin" / "downloadm3u8",
        Path("/usr/local/bin/downloadm3u8"),
        Path("/usr/bin/downloadm3u8"),
    ):
        if c.exists():
            return str(c)
    return which("downloadm3u8")


def emit_stage(code: str, label: str) -> None:
    print(f"STAGE {code} {label}", file=sys.stderr, flush=True)


def emit_progress(n: int) -> None:
    n = max(0, min(99, int(n)))
    print(f"PROGRESS {n}", file=sys.stderr, flush=True)


def parse_progress(line: str, last: int, duration_s: float | None) -> tuple[int, float | None]:
    dm = DURATION_RE.search(line)
    if dm and duration_s is None:
        h, mi, s = int(dm.group(1)), int(dm.group(2)), float(dm.group(3))
        duration_s = h * 3600 + mi * 60 + s

    m = TIME_RE.search(line)
    if m:
        h, mi, s = int(m.group(1)), int(m.group(2)), float(m.group(3))
        total = h * 3600 + mi * 60 + s
        if duration_s and duration_s > 0:
            nxt = min(95, max(5, int((total / duration_s) * 90) + 5))
        else:
            nxt = min(90, max(5, int(total / 2)))
        return (nxt if nxt > last else last), duration_s

    m = PROGRESS_RE.search(line)
    if m:
        nxt = min(99, max(1, int(m.group(1))))
        return (nxt if nxt > last else last), duration_s
    return last, duration_s


def run_cmd(cmd: list[str], timeout: int, progress_base: int = 0, progress_span: int = 90) -> None:
    last = 0
    duration_s: float | None = None
    tail: list[str] = []
    emit_progress(max(1, progress_base))
    proc = subprocess.Popen(
        cmd,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        bufsize=1,
        stdin=subprocess.DEVNULL,
    )
    assert proc.stdout is not None
    start = time.time()
    try:
        for line in proc.stdout:
            if time.time() - start > timeout:
                proc.kill()
                raise TimeoutError(f"Timed out after {timeout}s")
            # keep last lines for error diagnostics
            cleaned = line.rstrip()
            if cleaned:
                tail.append(cleaned)
                if len(tail) > 40:
                    tail = tail[-40:]
            last, duration_s = parse_progress(line, last, duration_s)
            if last > 0:
                mapped = progress_base + int((last / 100) * progress_span)
                emit_progress(min(99, mapped))
        code = proc.wait(timeout=5)
    except Exception:
        proc.kill()
        raise
    if code != 0:
        detail = " | ".join(tail[-8:]) if tail else "no output"
        raise RuntimeError(f"{cmd[0]} exited with code {code}: {detail}")


def ffmpeg_copy_args(fmt: str) -> list[str]:
    if fmt in AUDIO_ONLY:
        if fmt == "mp3":
            return ["-vn", "-c:a", "libmp3lame", "-q:a", "2"]
        return ["-vn", "-c:a", "aac", "-b:a", "192k"]
    if fmt == "webm":
        return ["-c:v", "libvpx-vp9", "-b:v", "0", "-crf", "32", "-c:a", "libopus"]
    if fmt == "mp4":
        return ["-c", "copy", "-bsf:a", "aac_adtstoasc", "-movflags", "+faststart"]
    if fmt == "mov":
        return ["-c", "copy", "-bsf:a", "aac_adtstoasc", "-movflags", "+faststart"]
    if fmt == "mkv":
        return ["-c", "copy"]
    if fmt == "ts":
        return ["-c", "copy"]
    return ["-c", "copy"]


def ffmpeg_fallback_args(fmt: str) -> list[str]:
    if fmt in AUDIO_ONLY:
        return ffmpeg_copy_args(fmt)
    if fmt == "webm":
        return ffmpeg_copy_args(fmt)
    # re-encode safely
    return [
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-crf",
        "23",
        "-c:a",
        "aac",
        "-b:a",
        "192k",
        "-movflags",
        "+faststart",
    ]


def download_ffmpeg(bin_path: str, url: str, output: str, fmt: str, timeout: int) -> None:
    common = [
        bin_path,
        "-nostdin",
        "-y",
        "-hide_banner",
        "-loglevel",
        "info",
        "-protocol_whitelist",
        "file,http,https,tcp,tls,crypto,httpproxy",
        "-reconnect",
        "1",
        "-reconnect_streamed",
        "1",
        "-reconnect_delay_max",
        "5",
        "-i",
        url,
    ]

    emit_stage("probing", "Probing stream")
    emit_progress(2)
    emit_stage("extracting", "Extracting segments")
    emit_progress(5)
    emit_stage("downloading", "Downloading segments")

    needs_encode = fmt in REENCODE_FORMATS
    if needs_encode:
        emit_stage("converting", f"Converting to {fmt.upper()}")
    else:
        emit_stage("combining", "Combining segments")

    try:
        run_cmd(common + ffmpeg_copy_args(fmt) + [output], timeout, 5, 85)
    except Exception:
        if Path(output).exists():
            Path(output).unlink(missing_ok=True)
        emit_stage("converting", f"Re-encoding to {fmt.upper()}")
        run_cmd(common + ffmpeg_fallback_args(fmt) + [output], timeout, 10, 80)

    emit_stage("finalizing", "Finalizing file")
    emit_progress(97)


def download_via_m3u8_then_convert(
    m3u8_bin: str,
    ffmpeg_bin: str | None,
    url: str,
    output: str,
    fmt: str,
    timeout: int,
) -> None:
    emit_stage("extracting", "Extracting playlist")
    emit_progress(3)
    emit_stage("downloading", "Downloading with m3u8downloader")

    with tempfile.TemporaryDirectory(prefix="m3u8dl_") as tmp:
        tmp_out = str(Path(tmp) / "raw.ts")
        # m3u8downloader usually writes mp4/ts based on extension
        if fmt == "mp4" and not ffmpeg_bin:
            tmp_out = output
        run_cmd([m3u8_bin, "-o", tmp_out, url], timeout, 5, 70)

        if tmp_out == output:
            emit_stage("finalizing", "Finalizing file")
            emit_progress(97)
            return

        if not ffmpeg_bin:
            # move as-is
            shutil.move(tmp_out, output)
            emit_stage("finalizing", "Finalizing file")
            return

        emit_stage("combining", "Merging segments")
        emit_progress(75)
        if fmt in REENCODE_FORMATS or fmt in AUDIO_ONLY:
            emit_stage("converting", f"Converting to {fmt.upper()}")
        else:
            emit_stage("converting", f"Packaging as {fmt.upper()}")

        cmd = [
            ffmpeg_bin,
            "-nostdin",
            "-y",
            "-hide_banner",
            "-loglevel",
            "info",
            "-i",
            tmp_out,
            *ffmpeg_copy_args(fmt),
            output,
        ]
        try:
            run_cmd(cmd, max(60, timeout // 3), 75, 20)
        except Exception:
            if Path(output).exists():
                Path(output).unlink(missing_ok=True)
            cmd = [
                ffmpeg_bin,
                "-nostdin",
                "-y",
                "-hide_banner",
                "-loglevel",
                "info",
                "-i",
                tmp_out,
                *ffmpeg_fallback_args(fmt),
                output,
            ]
            run_cmd(cmd, max(60, timeout // 3), 75, 20)

        emit_stage("finalizing", "Finalizing file")
        emit_progress(97)


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--url", required=True)
    p.add_argument("--output", required=True)
    p.add_argument("--format", default="mp4")
    p.add_argument(
        "--prefer",
        choices=("ffmpeg", "downloadm3u8"),
        default=os.environ.get("DOWNLOADER", "ffmpeg"),
    )
    p.add_argument(
        "--timeout",
        type=int,
        default=int(os.environ.get("DOWNLOAD_TIMEOUT_MS", "1800000")) // 1000,
    )
    args = p.parse_args()

    fmt = (args.format or "mp4").lower().lstrip(".")
    out = Path(args.output)
    out.parent.mkdir(parents=True, exist_ok=True)
    if out.exists():
        out.unlink()

    ffmpeg = find_ffmpeg()
    m3u8 = find_downloadm3u8()

    try:
        emit_stage("queued", "Starting")
        if args.prefer == "downloadm3u8" and m3u8:
            download_via_m3u8_then_convert(
                m3u8, ffmpeg, args.url, str(out), fmt, args.timeout
            )
        elif ffmpeg:
            download_ffmpeg(ffmpeg, args.url, str(out), fmt, args.timeout)
        elif m3u8:
            download_via_m3u8_then_convert(
                m3u8, ffmpeg, args.url, str(out), fmt, args.timeout
            )
        else:
            print(
                json.dumps(
                    {
                        "ok": False,
                        "error": "Neither ffmpeg nor downloadm3u8 is available",
                    }
                )
            )
            raise SystemExit(2)

        if not out.exists() or out.stat().st_size <= 0:
            raise RuntimeError("Output file missing or empty")

        print(
            json.dumps(
                {
                    "ok": True,
                    "tool": "ffmpeg" if ffmpeg else "downloadm3u8",
                    "output": str(out),
                    "fileSize": out.stat().st_size,
                    "format": fmt,
                }
            )
        )
    except Exception as e:  # noqa: BLE001
        if out.exists():
            out.unlink(missing_ok=True)
        print(json.dumps({"ok": False, "error": str(e)}))
        raise SystemExit(1)


if __name__ == "__main__":
    main()
