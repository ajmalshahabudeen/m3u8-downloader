#!/usr/bin/env python3
"""Deterministic media URL classifier + optional AI-assisted routing.

Rules first (fast, free). Optional OpenAI-compatible chat when CLASSIFY_AI_URL
and CLASSIFY_AI_KEY are set and confidence is low.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
from typing import Any
from urllib.parse import urlparse

# Hosts where public download is expected to fail due to DRM / official-only offline
DRM_HOST_HINTS = (
    "crunchyroll.com",
    "netflix.com",
    "disneyplus.com",
    "hulu.com",
    "max.com",
    "hbomax.com",
    "primevideo.com",
    "amazon.com/gp/video",
    "play.google.com/movies",
    "itunes.apple.com",
    "tv.apple.com",
    "peacocktv.com",
    "paramountplus.com",
)

YTDLP_HOST_HINTS = (
    "youtube.com",
    "youtu.be",
    "youtube-nocookie.com",
    "twitter.com",
    "x.com",
    "mobile.twitter.com",
    "vimeo.com",
    "twitch.tv",
    "reddit.com",
    "redd.it",
    "instagram.com",
    "facebook.com",
    "fb.watch",
    "tiktok.com",
    "soundcloud.com",
    "dailymotion.com",
    "bilibili.com",
    "nicovideo.jp",
    "streamable.com",
    "rumble.com",
    "odysee.com",
    "bitchute.com",
)

HLS_EXT_RE = re.compile(r"\.m3u8(\?|$)", re.I)
DASH_EXT_RE = re.compile(r"\.mpd(\?|$)", re.I)
DIRECT_MEDIA_RE = re.compile(
    r"\.(mp4|webm|mkv|mov|m4v|mp3|m4a|aac|flac|ogg|opus|wav)(\?|$)", re.I
)


def _host(url: str) -> str:
    try:
        return (urlparse(url).hostname or "").lower()
    except Exception:
        return ""


def _path(url: str) -> str:
    try:
        return urlparse(url).path or ""
    except Exception:
        return ""


def is_drm_likely(url: str) -> bool:
    low = url.lower()
    h = _host(url)
    for hint in DRM_HOST_HINTS:
        if hint in low or hint in h:
            return True
    return False


def classify_rules(url: str) -> dict[str, Any]:
    """Return routing decision without network I/O."""
    url = (url or "").strip()
    if not re.match(r"^https?://", url, re.I):
        return {
            "ok": False,
            "engine": "none",
            "confidence": 1.0,
            "reason": "Only http(s) URLs are supported",
            "needs_cookies": False,
            "is_drm_likely": False,
            "blocked": True,
            "error_code": "invalid_url",
        }

    if is_drm_likely(url):
        return {
            "ok": False,
            "engine": "none",
            "confidence": 0.95,
            "reason": (
                "This host typically uses DRM (Widevine/PlayReady). "
                "Only official offline features are supported — we will not bypass DRM."
            ),
            "needs_cookies": False,
            "is_drm_likely": True,
            "blocked": True,
            "error_code": "drm_blocked",
        }

    h = _host(url)
    path = _path(url)
    low = url.lower()

    if HLS_EXT_RE.search(url) or HLS_EXT_RE.search(path):
        return {
            "ok": True,
            "engine": "ffmpeg",
            "confidence": 0.98,
            "reason": "Direct HLS (.m3u8) playlist URL",
            "needs_cookies": False,
            "is_drm_likely": False,
            "blocked": False,
            "error_code": None,
        }

    if DASH_EXT_RE.search(url) or DASH_EXT_RE.search(path):
        return {
            "ok": True,
            "engine": "ytdlp",
            "confidence": 0.9,
            "reason": "DASH (.mpd) — route via yt-dlp",
            "needs_cookies": False,
            "is_drm_likely": False,
            "blocked": False,
            "error_code": None,
        }

    if DIRECT_MEDIA_RE.search(url) or DIRECT_MEDIA_RE.search(path):
        return {
            "ok": True,
            "engine": "direct",
            "confidence": 0.92,
            "reason": "Direct progressive media file URL",
            "needs_cookies": False,
            "is_drm_likely": False,
            "blocked": False,
            "error_code": None,
        }

    for hint in YTDLP_HOST_HINTS:
        if hint in h or hint in low:
            needs_cookies = any(
                x in h for x in ("instagram.com", "facebook.com", "tiktok.com")
            )
            return {
                "ok": True,
                "engine": "ytdlp",
                "confidence": 0.93,
                "reason": f"Known site host ({hint}) — yt-dlp",
                "needs_cookies": needs_cookies,
                "is_drm_likely": False,
                "blocked": False,
                "error_code": None,
            }

    # Generic page — prefer yt-dlp generic, fallback extract+hls in downloader
    return {
        "ok": True,
        "engine": "auto",
        "confidence": 0.55,
        "reason": "Unknown host — try yt-dlp then page extract / HLS",
        "needs_cookies": False,
        "is_drm_likely": False,
        "blocked": False,
        "error_code": None,
    }


def classify_with_ai(url: str, base: dict[str, Any], html_snippet: str = "") -> dict[str, Any]:
    """Optional OpenAI-compatible chat completion to refine low-confidence routes."""
    api_url = (os.environ.get("CLASSIFY_AI_URL") or "").strip()
    api_key = (os.environ.get("CLASSIFY_AI_KEY") or "").strip()
    model = (os.environ.get("CLASSIFY_AI_MODEL") or "gpt-4o-mini").strip()
    if not api_url or not api_key:
        base = dict(base)
        base["ai"] = {"used": False, "reason": "CLASSIFY_AI_URL/KEY not set"}
        return base
    if float(base.get("confidence") or 0) >= 0.8 and base.get("engine") != "auto":
        base = dict(base)
        base["ai"] = {"used": False, "reason": "high confidence rules"}
        return base

    try:
        import urllib.request

        system = (
            "You route public video URLs to a download engine. "
            "Reply ONLY JSON: "
            '{"engine":"ytdlp|ffmpeg|direct|extract_hls|none","confidence":0-1,'
            '"reason":"...","needs_cookies":bool,"is_drm_likely":bool,"blocked":bool}. '
            "Use none+blocked for DRM SVOD. Never suggest DRM bypass."
        )
        user = f"URL: {url}\nHTML snippet (may be empty):\n{(html_snippet or '')[:2500]}"
        body = json.dumps(
            {
                "model": model,
                "temperature": 0,
                "messages": [
                    {"role": "system", "content": system},
                    {"role": "user", "content": user},
                ],
                "response_format": {"type": "json_object"},
            }
        ).encode()
        req = urllib.request.Request(
            api_url.rstrip("/") + ("/chat/completions" if not api_url.rstrip("/").endswith("chat/completions") else ""),
            data=body,
            headers={
                "Content-Type": "application/json",
                "Authorization": f"Bearer {api_key}",
            },
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=25) as resp:
            data = json.loads(resp.read().decode())
        content = data["choices"][0]["message"]["content"]
        parsed = json.loads(content)
        engine = str(parsed.get("engine") or base.get("engine") or "auto")
        if engine not in ("ytdlp", "ffmpeg", "direct", "extract_hls", "auto", "none"):
            engine = base.get("engine") or "auto"
        out = {
            "ok": not bool(parsed.get("blocked")) and engine != "none",
            "engine": engine if engine != "none" else "none",
            "confidence": float(parsed.get("confidence") or base.get("confidence") or 0.5),
            "reason": str(parsed.get("reason") or base.get("reason") or "ai"),
            "needs_cookies": bool(parsed.get("needs_cookies")),
            "is_drm_likely": bool(parsed.get("is_drm_likely")),
            "blocked": bool(parsed.get("blocked")) or engine == "none",
            "error_code": "drm_blocked" if parsed.get("is_drm_likely") else (
                "blocked" if parsed.get("blocked") else None
            ),
            "ai": {"used": True, "model": model},
        }
        return out
    except Exception as e:  # noqa: BLE001
        base = dict(base)
        base["ai"] = {"used": False, "error": str(e)[:200]}
        return base


def classify(url: str, use_ai: bool = True, html_snippet: str = "") -> dict[str, Any]:
    base = classify_rules(url)
    if use_ai:
        return classify_with_ai(url, base, html_snippet=html_snippet)
    base["ai"] = {"used": False}
    return base


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--url", required=True)
    p.add_argument("--no-ai", action="store_true")
    p.add_argument("--html", default="")
    args = p.parse_args()
    print(json.dumps(classify(args.url, use_ai=not args.no_ai, html_snippet=args.html), ensure_ascii=False))


if __name__ == "__main__":
    main()
