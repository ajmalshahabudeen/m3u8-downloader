#!/usr/bin/env python3
"""Universal public-video downloader: yt-dlp + HLS/ffmpeg + direct HTTP.

Modes:
  analyze  — classify + list formats (no download)
  download — full download with STAGE/PROGRESS on stderr, JSON on stdout

Usage:
  python all_video_download.py --mode analyze --url URL
  python all_video_download.py --mode download --url URL --output /path/out.mp4 \\
      --format mp4 --quality best --engine auto
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
from typing import Any
from urllib.parse import urlparse
from urllib.request import Request, urlopen

from classify_media import classify
from stream_headers import browser_headers, explain_http_error

# Limits (env overridable)
MAX_FILE_BYTES = int(os.environ.get("ALL_VIDEO_MAX_FILE_BYTES", str(8 * 1024**3)))  # 8 GiB
DEFAULT_TIMEOUT = int(os.environ.get("ALL_VIDEO_TIMEOUT_S", "1800"))

HLS_EXT_RE = re.compile(r"\.m3u8(\?|$)", re.I)


def emit_stage(code: str, label: str) -> None:
    print(f"STAGE {code} {label}", file=sys.stderr, flush=True)


def emit_progress(n: int) -> None:
    n = max(0, min(100, int(n)))
    print(f"PROGRESS {n}", file=sys.stderr, flush=True)


def die_result(error: str, code: int = 1, **extra: Any) -> None:
    payload = {"ok": False, "error": explain_http_error(error), **extra}
    print(json.dumps(payload, ensure_ascii=False))
    raise SystemExit(code)


def ensure_cookie_header(cookie_path: str | None) -> str | None:
    if not cookie_path:
        return None
    p = Path(cookie_path)
    if not p.is_file():
        return None
    try:
        content = p.read_text(encoding="utf-8", errors="ignore")
        clean = content.replace("\r\n", "\n").strip()
        if clean and not clean.startswith("# Netscape"):
            clean = "# Netscape HTTP Cookie File\n" + clean
            p.write_text(clean, encoding="utf-8")
    except Exception:
        pass
    return str(p)


def quality_to_ytdlp_format(quality: str, audio_only: bool) -> str:
    q = (quality or "best").lower().strip()
    if audio_only:
        return "ba/b/bestaudio/best"
    if q in ("best", "auto", ""):
        return "bv*+ba/b/bestvideo+bestaudio/best"
    if q in ("worst", "worstvideo"):
        return "wv*+wa/w/worstvideo+worstaudio/worst"
    m = re.match(r"^(\d{3,4})p?$", q)
    if m:
        h = int(m.group(1))
        return f"bv*[height<={h}]+ba/b[height<={h}]/bestvideo[height<={h}]+bestaudio/best[height<={h}]/b/best"
    if re.match(r"^\d+$", q):
        return f"{q}+ba/{q}/bv*+ba/b/best"
    # passthrough custom selector
    return quality


def sanitize_title(title: str) -> str:
    base = (title or "video").strip()
    base = re.sub(r'[<>:"/\\|?*\x00-\x1f]', "", base)
    base = re.sub(r"\s+", " ", base).strip(" .")[:180]
    return base or "video"


def map_ytdlp_error(msg: str) -> dict[str, str]:
    low = (msg or "").lower()
    if "drm" in low or "widevine" in low or "protected" in low and "drm" in low:
        return {
            "error_code": "drm_blocked",
            "error": "This stream is DRM-protected. Official offline apps only — we do not bypass DRM.",
        }
    if "sign in" in low or "login required" in low or "private video" in low:
        return {
            "error_code": "login_required",
            "error": "Login/cookies required for this URL. Upload a cookies.txt from your browser session.",
        }
    if "age" in low and ("restrict" in low or "confirm" in low or "gate" in low):
        return {
            "error_code": "age_gate",
            "error": "Age-restricted content. Provide cookies.txt from a logged-in browser session.",
        }
    if "geo" in low or "not available in your country" in low or "blocked it in your country" in low:
        return {
            "error_code": "geo_blocked",
            "error": "Geo-blocked in this server region.",
        }
    if "unsupported url" in low or "no video formats" in low or "no media found" in low:
        return {
            "error_code": "unsupported",
            "error": msg or "Unsupported or no media found at URL",
        }
    if "http error 403" in low or "403" in low:
        return {"error_code": "forbidden", "error": msg or "HTTP 403 Forbidden"}
    if "http error 404" in low or "404" in low:
        return {"error_code": "not_found", "error": msg or "HTTP 404 Not Found"}
    if "requested format is not available" in low:
        return {
            "error_code": "format_not_available",
            "error": "The requested video format is not available for this session. Try choosing 'Best available' or auto quality.",
        }
    return {"error_code": "download_failed", "error": msg or "Download failed"}


def ytdlp_available() -> bool:
    try:
        import yt_dlp  # noqa: F401

        return True
    except ImportError:
        return shutil.which("yt-dlp") is not None or shutil.which("yt_dlp") is not None


def _progress_hook_factory():
    last = [0]

    def hook(d: dict) -> None:
        status = d.get("status")
        if status == "downloading":
            total = d.get("total_bytes") or d.get("total_bytes_estimate") or 0
            done = d.get("downloaded_bytes") or 0
            if total:
                pct = int(done * 90 / total)
            else:
                # playlist / unknown size
                pstr = d.get("_percent_str") or "0%"
                try:
                    pct = int(float(pstr.replace("%", "").strip()) * 0.9)
                except ValueError:
                    pct = last[0]
            if pct > last[0]:
                last[0] = pct
                emit_progress(max(1, min(90, pct)))
            emit_stage("downloading", "Downloading media")
        elif status == "finished":
            emit_stage("finalizing", "Processing downloaded file")
            emit_progress(max(last[0], 92))
        elif status == "error":
            emit_stage("failed", "Download error")

    return hook


def run_ytdlp_analyze(url: str, cookie_path: str | None, referer: str | None) -> dict[str, Any]:
    import yt_dlp

    opts: dict[str, Any] = {
        "quiet": True,
        "no_warnings": True,
        "skip_download": True,
        "noplaylist": True,
        "extract_flat": False,
        "socket_timeout": 30,
    }
    cookie_path = ensure_cookie_header(cookie_path)
    if cookie_path and Path(cookie_path).is_file():
        opts["cookiefile"] = cookie_path
    opts["js_runtimes"] = {"node": {}}
    opts["remote_components"] = ["ejs:github"]
    opts["extractor_args"] = {"youtube": {"player_client": ["mweb", "web", "tv"]}}
    headers = browser_headers(url, referer=referer)
    opts["http_headers"] = headers

    with yt_dlp.YoutubeDL(opts) as ydl:
        info = ydl.extract_info(url, download=False)

    if info is None:
        raise RuntimeError("No metadata returned")

    # playlist
    if info.get("_type") == "playlist":
        entries = info.get("entries") or []
        formats_out = []
        return {
            "ok": True,
            "engine": "ytdlp",
            "isPlaylist": True,
            "playlistCount": info.get("playlist_count") or len(list(entries)),
            "title": info.get("title") or "Playlist",
            "extractor": info.get("extractor") or info.get("ie_key"),
            "thumbnail": info.get("thumbnail"),
            "formats": formats_out,
            "webpage_url": info.get("webpage_url") or url,
            "duration": None,
        }

    formats = []
    for f in info.get("formats") or []:
        if not f:
            continue
        formats.append(
            {
                "id": f.get("format_id"),
                "ext": f.get("ext"),
                "resolution": f.get("resolution")
                or (
                    f"{f.get('width')}x{f.get('height')}"
                    if f.get("height")
                    else None
                ),
                "height": f.get("height"),
                "fps": f.get("fps"),
                "vcodec": f.get("vcodec"),
                "acodec": f.get("acodec"),
                "tbr": f.get("tbr"),
                "abr": f.get("abr"),
                "vbr": f.get("vbr"),
                "filesize": f.get("filesize") or f.get("filesize_approx"),
                "note": f.get("format_note"),
                "label": f.get("format") or f.get("format_id") or "format",
            }
        )
    # sort: height desc
    formats.sort(key=lambda x: (x.get("height") or 0, x.get("tbr") or 0), reverse=True)

    return {
        "ok": True,
        "engine": "ytdlp",
        "isPlaylist": False,
        "title": info.get("title") or "video",
        "extractor": info.get("extractor") or info.get("ie_key"),
        "thumbnail": info.get("thumbnail"),
        "duration": info.get("duration"),
        "webpage_url": info.get("webpage_url") or url,
        "formats": formats[:40],
        "description": (info.get("description") or "")[:500],
    }


def run_ytdlp_playlist_analyze(url: str, cookie_path: str | None, referer: str | None) -> dict[str, Any]:
    import yt_dlp

    opts: dict[str, Any] = {
        "quiet": True,
        "no_warnings": True,
        "skip_download": True,
        "extract_flat": "in_playlist",
        "socket_timeout": 45,
        "ignoreerrors": True,
    }
    cookie_path = ensure_cookie_header(cookie_path)
    if cookie_path and Path(cookie_path).is_file():
        opts["cookiefile"] = cookie_path
    opts["js_runtimes"] = {"node": {}}
    opts["remote_components"] = ["ejs:github"]
    opts["extractor_args"] = {"youtube": {"player_client": ["mweb", "web", "tv"]}}
    headers = browser_headers(url, referer=referer)
    opts["http_headers"] = headers

    with yt_dlp.YoutubeDL(opts) as ydl:
        info = ydl.extract_info(url, download=False)

    if info is None:
        raise RuntimeError("No playlist metadata returned")

    title = info.get("title") or "YouTube Playlist"
    uploader = info.get("uploader") or info.get("channel") or info.get("uploader_id") or ""
    webpage_url = info.get("webpage_url") or url

    raw_entries = info.get("entries") or []
    videos = []

    for idx, entry in enumerate(raw_entries, start=1):
        if not entry:
            continue
        v_id = entry.get("id")
        v_title = entry.get("title") or entry.get("name") or (f"Video {idx}" if v_id else None)
        if not v_title:
            continue

        v_url = entry.get("url") or entry.get("webpage_url")
        if not v_url or not v_url.startswith("http"):
            if v_id:
                v_url = f"https://www.youtube.com/watch?v={v_id}"
            else:
                continue

        duration = entry.get("duration")
        uploader_item = entry.get("uploader") or entry.get("channel") or uploader

        thumbnail = entry.get("thumbnail")
        if not thumbnail and v_id:
            thumbnail = f"https://i.ytimg.com/vi/{v_id}/hqdefault.jpg"

        videos.append(
            {
                "index": idx,
                "id": v_id,
                "title": v_title,
                "url": v_url,
                "duration": duration,
                "uploader": uploader_item,
                "thumbnail": thumbnail,
            }
        )

    return {
        "ok": True,
        "title": title,
        "uploader": uploader,
        "playlistCount": len(videos),
        "webpageUrl": webpage_url,
        "videos": videos,
    }



def run_ytdlp_download(
    url: str,
    output_path: str,
    *,
    merge_format: str,
    ytdlp_format: str,
    cookie_path: str | None,
    referer: str | None,
    playlist: bool,
    timeout_s: int,
) -> dict[str, Any]:
    import yt_dlp

    out = Path(output_path)
    out.parent.mkdir(parents=True, exist_ok=True)
    # yt-dlp outtmpl without extension — we want final name; use temp template then rename
    tmp_dir = out.parent
    tmpl = str(tmp_dir / (out.stem + ".%(ext)s"))

    opts: dict[str, Any] = {
        "outtmpl": tmpl,
        "format": ytdlp_format,
        "merge_output_format": merge_format if merge_format in ("mp4", "mkv", "webm") else "mp4",
        "noplaylist": not playlist,
        "quiet": True,
        "no_warnings": False,
        "progress_hooks": [_progress_hook_factory()],
        "socket_timeout": 30,
        "retries": 5,
        "fragment_retries": 5,
        "concurrent_fragment_downloads": 4,
        "overwrites": True,
        "restrictfilenames": False,
        "windowsfilenames": True,
    }
    # audio-only requested formats
    if merge_format in ("mp3", "m4a"):
        opts["format"] = "ba/b"
        opts["postprocessors"] = [
            {
                "key": "FFmpegExtractAudio",
                "preferredcodec": merge_format,
                "preferredquality": "192",
            }
        ]
        opts.pop("merge_output_format", None)

    cookie_path = ensure_cookie_header(cookie_path)
    if cookie_path and Path(cookie_path).is_file():
        opts["cookiefile"] = cookie_path
    opts["js_runtimes"] = {"node": {}}
    opts["remote_components"] = ["ejs:github"]
    opts["extractor_args"] = {"youtube": {"player_client": ["mweb", "web", "tv"]}}
    opts["http_headers"] = browser_headers(url, referer=referer)

    emit_stage("probing", "Extracting media info (yt-dlp)")
    emit_progress(2)

    start = time.time()
    with yt_dlp.YoutubeDL(opts) as ydl:
        info = ydl.extract_info(url, download=True)
        if time.time() - start > timeout_s:
            raise TimeoutError(f"yt-dlp exceeded {timeout_s}s")

    if info is None:
        raise RuntimeError("yt-dlp returned no info")

    # Find produced file
    requested = None
    if isinstance(info, dict):
        requested = info.get("requested_downloads") or []
        filepath = info.get("filepath") or info.get("_filename")
        if not filepath and requested:
            filepath = requested[0].get("filepath")
        title = info.get("title") or out.stem
        extractor = info.get("extractor")
    else:
        filepath = None
        title = out.stem
        extractor = None

    produced: Path | None = None
    if filepath and Path(filepath).exists():
        produced = Path(filepath)
    else:
        # search temp dir for newest matching stem
        candidates = sorted(tmp_dir.glob(out.stem + ".*"), key=lambda p: p.stat().st_mtime, reverse=True)
        for c in candidates:
            if c.suffix.lower() in {
                ".mp4",
                ".mkv",
                ".webm",
                ".mov",
                ".mp3",
                ".m4a",
                ".opus",
                ".ogg",
            }:
                produced = c
                break

    if not produced or not produced.exists():
        raise RuntimeError("yt-dlp finished but output file not found")

    size = produced.stat().st_size
    if size <= 0:
        raise RuntimeError("Empty output file")
    if size > MAX_FILE_BYTES:
        produced.unlink(missing_ok=True)
        raise RuntimeError(f"File exceeds max size ({MAX_FILE_BYTES} bytes)")

    # Move/rename to desired output path (extension may differ for audio)
    final = out
    if produced.suffix.lower() != out.suffix.lower():
        final = out.with_suffix(produced.suffix)
    if produced.resolve() != final.resolve():
        if final.exists():
            final.unlink()
        shutil.move(str(produced), str(final))

    emit_stage("completed", "Completed")
    emit_progress(100)
    return {
        "ok": True,
        "tool": "ytdlp",
        "engine": "ytdlp",
        "output": str(final),
        "fileSize": final.stat().st_size,
        "format": final.suffix.lstrip("."),
        "title": sanitize_title(str(title)),
        "extractor": extractor,
    }


def run_direct_download(url: str, output_path: str, referer: str | None, timeout_s: int) -> dict[str, Any]:
    emit_stage("downloading", "Downloading file")
    headers = browser_headers(url, referer=referer)
    req = Request(url, headers=headers, method="GET")
    out = Path(output_path)
    out.parent.mkdir(parents=True, exist_ok=True)
    downloaded = 0
    with urlopen(req, timeout=min(60, timeout_s)) as resp, open(out, "wb") as f:
        total = int(resp.headers.get("Content-Length") or 0)
        while True:
            chunk = resp.read(1024 * 256)
            if not chunk:
                break
            f.write(chunk)
            downloaded += len(chunk)
            if downloaded > MAX_FILE_BYTES:
                f.close()
                out.unlink(missing_ok=True)
                raise RuntimeError(f"File exceeds max size ({MAX_FILE_BYTES} bytes)")
            if total:
                emit_progress(min(95, int(downloaded * 95 / total)))
    if not out.exists() or out.stat().st_size <= 0:
        raise RuntimeError("Direct download produced empty file")
    emit_progress(100)
    emit_stage("completed", "Completed")
    return {
        "ok": True,
        "tool": "direct",
        "engine": "direct",
        "output": str(out),
        "fileSize": out.stat().st_size,
        "format": out.suffix.lstrip(".") or "bin",
    }


def run_ffmpeg_download(
    url: str,
    output_path: str,
    fmt: str,
    referer: str | None,
    timeout_s: int,
) -> dict[str, Any]:
    """Delegate to existing download_stream.py (isolated child)."""
    script = Path(__file__).resolve().parent / "download_stream.py"
    cmd = [
        sys.executable,
        str(script),
        "--url",
        url,
        "--output",
        output_path,
        "--format",
        fmt,
        "--prefer",
        "ffmpeg",
        "--timeout",
        str(timeout_s),
    ]
    if referer:
        cmd.extend(["--referer", referer])
    emit_stage("downloading", "HLS download (ffmpeg)")
    proc = subprocess.Popen(
        cmd,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        stdin=subprocess.DEVNULL,
        text=True,
    )
    assert proc.stderr is not None and proc.stdout is not None
    stdout_chunks: list[str] = []
    for line in proc.stderr:
        line = line.rstrip("\n")
        if line.startswith("STAGE ") or line.startswith("PROGRESS "):
            print(line, file=sys.stderr, flush=True)
        # else ignore noisy ffmpeg
    out = proc.stdout.read()
    stdout_chunks.append(out)
    code = proc.wait(timeout=timeout_s + 60)
    text = "".join(stdout_chunks).strip()
    try:
        data = json.loads(text.splitlines()[-1] if text else "{}")
    except json.JSONDecodeError as e:
        raise RuntimeError(f"ffmpeg worker invalid JSON (exit {code})") from e
    if not data.get("ok"):
        raise RuntimeError(data.get("error") or f"ffmpeg failed exit {code}")
    data["engine"] = "ffmpeg"
    data["tool"] = data.get("tool") or "ffmpeg"
    return data


def try_extract_hls(url: str) -> str | None:
    """Use extract_stream.py deep scrape to find an m3u8."""
    script = Path(__file__).resolve().parent / "extract_stream.py"
    cmd = [sys.executable, str(script), "--url", url, "--deep"]
    emit_stage("extracting", "Scanning page for streams")
    try:
        proc = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=150,
            stdin=subprocess.DEVNULL,
        )
        text = (proc.stdout or "").strip()
        if not text:
            return None
        data = json.loads(text.splitlines()[-1])
        return data.get("m3u8Url") or None
    except Exception:
        return None


def analyze(url: str, cookie_path: str | None, referer: str | None, use_ai: bool) -> dict[str, Any]:
    decision = classify(url, use_ai=use_ai)
    result: dict[str, Any] = {
        "ok": True,
        "url": url,
        "classification": decision,
        "title": None,
        "formats": [],
        "engine": decision.get("engine"),
        "warnings": [],
        "disclaimer": (
            "Only download content you have the right to access. "
            "DRM-protected services are not supported."
        ),
    }

    if decision.get("blocked") or not decision.get("ok"):
        result["ok"] = False
        result["error"] = decision.get("reason")
        result["error_code"] = decision.get("error_code") or "blocked"
        return result

    engine = decision.get("engine") or "auto"

    if engine in ("ytdlp", "auto") and ytdlp_available():
        try:
            emit_stage("probing", "Analyzing with yt-dlp")
            meta = run_ytdlp_analyze(url, cookie_path, referer)
            result.update({k: v for k, v in meta.items() if k != "ok"})
            result["ok"] = True
            result["engine"] = "ytdlp"
            return result
        except Exception as e:  # noqa: BLE001
            mapped = map_ytdlp_error(str(e))
            if engine == "ytdlp":
                result["ok"] = False
                result["error"] = mapped["error"]
                result["error_code"] = mapped["error_code"]
                return result
            result["warnings"].append(f"yt-dlp analyze failed: {mapped['error']}")

    if engine == "ffmpeg" or HLS_EXT_RE.search(url):
        result["engine"] = "ffmpeg"
        result["title"] = "HLS stream"
        result["formats"] = [
            {"id": "hls", "label": "HLS / ffmpeg", "height": None, "ext": "mp4"}
        ]
        return result

    if engine == "direct":
        result["engine"] = "direct"
        result["title"] = Path(urlparse(url).path).name or "media"
        result["formats"] = [
            {"id": "direct", "label": "Direct file", "height": None, "ext": Path(urlparse(url).path).suffix.lstrip(".")}
        ]
        return result

    # auto fallback: try page extract
    m3u8 = try_extract_hls(url)
    if m3u8:
        result["engine"] = "extract_hls"
        result["title"] = "Extracted stream"
        result["resolvedUrl"] = m3u8
        result["formats"] = [
            {"id": "hls", "label": "Extracted HLS", "url": m3u8, "ext": "mp4"}
        ]
        return result

    result["ok"] = False
    result["error"] = "Could not find a public downloadable stream at this URL"
    result["error_code"] = "unsupported"
    return result


def download(
    url: str,
    output_path: str,
    *,
    fmt: str,
    quality: str,
    engine: str,
    cookie_path: str | None,
    referer: str | None,
    playlist: bool,
    ytdlp_format: str | None,
    timeout_s: int,
    use_ai: bool,
) -> dict[str, Any]:
    decision = classify(url, use_ai=use_ai)
    if decision.get("blocked") or not decision.get("ok"):
        die_result(decision.get("reason") or "Blocked", error_code=decision.get("error_code"))

    chosen = (engine or decision.get("engine") or "auto").lower()
    if chosen == "auto":
        chosen = decision.get("engine") or "auto"

    audio_only = fmt in ("mp3", "m4a")
    if ytdlp_format:
        sel = f"{ytdlp_format}+ba/{ytdlp_format}/bv*+ba/b/best" if not audio_only else f"{ytdlp_format}/ba/b/best"
    else:
        sel = quality_to_ytdlp_format(quality, audio_only)

    # Resolve auto chain
    if chosen in ("ytdlp", "auto") and ytdlp_available():
        try:
            return run_ytdlp_download(
                url,
                output_path,
                merge_format=fmt,
                ytdlp_format=sel,
                cookie_path=cookie_path,
                referer=referer,
                playlist=playlist,
                timeout_s=timeout_s,
            )
        except Exception as e:  # noqa: BLE001
            mapped = map_ytdlp_error(str(e))
            if chosen == "ytdlp":
                die_result(mapped["error"], error_code=mapped["error_code"])
            # auto: fall through
            emit_stage("extracting", "yt-dlp failed — trying other engines")

    media_url = url
    if chosen in ("extract_hls", "auto") and not HLS_EXT_RE.search(url):
        found = try_extract_hls(url)
        if found:
            media_url = found
            chosen = "ffmpeg"
            referer = referer or url

    if chosen == "direct" or (
        chosen == "auto" and re.search(r"\.(mp4|webm|mkv|mov|mp3|m4a)(\?|$)", media_url, re.I)
    ):
        try:
            return run_direct_download(media_url, output_path, referer, timeout_s)
        except Exception as e:  # noqa: BLE001
            if chosen == "direct":
                die_result(str(e), error_code="download_failed")

    if chosen in ("ffmpeg", "extract_hls", "auto") or HLS_EXT_RE.search(media_url):
        try:
            return run_ffmpeg_download(media_url, output_path, fmt, referer, timeout_s)
        except Exception as e:  # noqa: BLE001
            die_result(str(e), error_code="download_failed")

    die_result("No suitable download engine succeeded", error_code="unsupported")


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--mode", choices=("analyze", "playlist_analyze", "download"), default="download")
    p.add_argument("--url", required=True)
    p.add_argument("--output", default="")
    p.add_argument("--format", default="mp4")
    p.add_argument("--quality", default="best")
    p.add_argument("--engine", default="auto")
    p.add_argument("--referer", default="")
    p.add_argument("--cookies", default="")
    p.add_argument("--playlist", action="store_true")
    p.add_argument("--ytdlp-format", default="")
    p.add_argument("--timeout", type=int, default=DEFAULT_TIMEOUT)
    p.add_argument("--no-ai", action="store_true")
    args = p.parse_args()

    url = args.url.strip()
    cookie_path = args.cookies.strip() or None
    referer = args.referer.strip() or None

    if args.mode == "playlist_analyze":
        try:
            res = run_ytdlp_playlist_analyze(url, cookie_path, referer)
            print(json.dumps(res, ensure_ascii=False))
        except Exception as e:
            die_result(str(e))
        return

    if args.mode == "analyze":
        print(json.dumps(analyze(url, cookie_path, referer, use_ai=not args.no_ai), ensure_ascii=False))
        return

    if not args.output.strip():
        die_result("--output required for download mode")

    try:
        result = download(
            url,
            args.output.strip(),
            fmt=(args.format or "mp4").lower(),
            quality=args.quality or "best",
            engine=args.engine or "auto",
            cookie_path=cookie_path,
            referer=referer,
            playlist=bool(args.playlist),
            ytdlp_format=args.ytdlp_format.strip() or None,
            timeout_s=max(60, int(args.timeout)),
            use_ai=not args.no_ai,
        )
        print(json.dumps(result, ensure_ascii=False))
    except SystemExit:
        raise
    except Exception as e:  # noqa: BLE001
        die_result(str(e))


if __name__ == "__main__":
    main()
