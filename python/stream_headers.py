#!/usr/bin/env python3
"""Shared HTTP headers for probing/downloading CDN-protected HLS streams.

Many CDNs (phncdn, xhcdn, etc.) return 403/412 unless the client sends a
browser User-Agent plus a matching Referer/Origin from the site that embeds
the player. Plain ffmpeg has neither by default.
"""
from __future__ import annotations

import re
from urllib.parse import urlparse

DEFAULT_UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/122.0.0.0 Safari/537.36"
)

# host substring / regex → site origin used as Referer
_CDN_ORIGIN_RULES: list[tuple[re.Pattern[str], str]] = [
    (re.compile(r"phncdn\.com|pornhub", re.I), "https://www.pornhub.com/"),
    (re.compile(r"beeg\.com", re.I), "https://beeg.com/"),
    (re.compile(r"xhcdn\.com|xhamster", re.I), "https://xhamster.com/"),
    (re.compile(r"xvideos|xv-cdn|xvid", re.I), "https://www.xvideos.com/"),
    (re.compile(r"spankbang", re.I), "https://spankbang.com/"),
    (re.compile(r"cdn77|highwebmedia|chaturbate", re.I), "https://chaturbate.com/"),
    (re.compile(r"stripcash|stripchat", re.I), "https://stripchat.com/"),
    (re.compile(r"dailymotion|dmcdn", re.I), "https://www.dailymotion.com/"),
    (re.compile(r"vimeocdn|vimeo", re.I), "https://vimeo.com/"),
    (re.compile(r"twitch|ttvnw", re.I), "https://www.twitch.tv/"),
]


def origin_from_url(url: str) -> str | None:
    try:
        p = urlparse(url)
        if p.scheme and p.netloc:
            return f"{p.scheme}://{p.netloc}/"
    except Exception:
        return None
    return None


def infer_referer(stream_url: str, explicit: str | None = None) -> str | None:
    """Prefer explicit page URL; else map known CDNs; else stream origin."""
    if explicit:
        exp = explicit.strip()
        if exp:
            # normalize to origin + path root if it's a full page URL
            return exp if exp.endswith("/") or "?" in exp or "/" in exp[8:] else exp + "/"
    host_path = ""
    try:
        p = urlparse(stream_url)
        host_path = f"{p.netloc}{p.path}"
    except Exception:
        host_path = stream_url
    for pattern, origin in _CDN_ORIGIN_RULES:
        if pattern.search(host_path) or pattern.search(stream_url):
            return origin
    return origin_from_url(stream_url)


def browser_headers(
    stream_url: str,
    referer: str | None = None,
    user_agent: str | None = None,
) -> dict[str, str]:
    ua = (user_agent or DEFAULT_UA).strip()
    ref = infer_referer(stream_url, referer)
    headers: dict[str, str] = {
        "User-Agent": ua,
        "Accept": "*/*",
        "Accept-Language": "en-US,en;q=0.9",
        "Connection": "keep-alive",
    }
    if ref:
        headers["Referer"] = ref
        origin = origin_from_url(ref)
        if origin:
            headers["Origin"] = origin.rstrip("/")
    return headers


def ffmpeg_header_args(
    stream_url: str,
    referer: str | None = None,
    user_agent: str | None = None,
) -> list[str]:
    """Args to insert before -i for ffmpeg (user_agent + headers)."""
    h = browser_headers(stream_url, referer=referer, user_agent=user_agent)
    ua = h.get("User-Agent", DEFAULT_UA)
    # ffmpeg wants each header line terminated with CRLF
    lines = []
    for k, v in h.items():
        if k.lower() == "user-agent":
            continue  # passed separately via -user_agent
        lines.append(f"{k}: {v}")
    header_blob = "".join(f"{ln}\r\n" for ln in lines)
    args = ["-user_agent", ua]
    if header_blob:
        args.extend(["-headers", header_blob])
    return args


def explain_http_error(message: str) -> str:
    """Append a human hint for common CDN failures."""
    low = message.lower()
    if "412" in message or "precondition failed" in low:
        return (
            message
            + " — CDN rejected the request (HTTP 412). Usually missing Referer/User-Agent "
            "or an expired signed URL. Re-extract the stream from the page and start "
            "download immediately."
        )
    if "403" in message or "forbidden" in low:
        return (
            message
            + " — CDN forbade access (HTTP 403). Try re-extracting; the link may need "
            "cookies or a fresh signed token."
        )
    if "404" in message:
        return message + " — stream not found (expired or moved). Re-extract from the page."
    return message
