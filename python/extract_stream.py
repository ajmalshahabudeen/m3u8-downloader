#!/usr/bin/env python3
"""Extract title + m3u8 URLs from a page.

Strategies (all server-side):
  1. direct   — URL is already .m3u8
  2. html     — static HTTP fetch + BeautifulSoup regex
  3. browser  — Playwright headless Chromium:
       - full JS execution
       - network request interception for .m3u8 / HLS
       - walk same-origin + nested iframes
       - optional play-button click to trigger players
       - performance resource timeline scan

Usage:
  python extract_stream.py --url "https://example.com/watch/1"
  python extract_stream.py --url "..." --deep          # force browser even if static finds hits
  python extract_stream.py --url "..." --no-browser    # static only
"""
from __future__ import annotations

import argparse
import json
import re
import sys
import time
from html import unescape
from typing import Any
from urllib.parse import urljoin, urlparse

import requests
from bs4 import BeautifulSoup

UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/122.0.0.0 Safari/537.36"
)
TIMEOUT = 25
# Transient TLS/CDN resets are common on adult/video CDNs — retry before failing
FETCH_ATTEMPTS = 5
FETCH_BACKOFF_S = (0.6, 1.2, 2.0, 3.5)
BROWSER_TIMEOUT_MS = 45_000

M3U8_ABS_RE = re.compile(
    r"https?://[^\s\"'<>\\]+?\.m3u8(?:\?[^\s\"'<>\\]*)?",
    re.I,
)
M3U8_ESC_RE = re.compile(
    r"https?:\\/\\/[^\s\"'<>]+?\.m3u8(?:\\u0026|\?|[^\s\"'<>\\]*)*",
    re.I,
)
M3U8_REL_RE = re.compile(
    r"""["']([^"']+\.m3u8(?:\?[^"']*)?)["']""",
    re.I,
)
HLS_HINT_RE = re.compile(
    r"(application/vnd\.apple\.mpegurl|application/x-mpegURL|\.m3u8)",
    re.I,
)
PLAY_SELECTORS = [
    "button[aria-label*='play' i]",
    "button[title*='play' i]",
    ".vjs-big-play-button",
    ".ytp-large-play-button",
    ".plyr__control--overlaid",
    ".jw-icon-display",
    "button.play",
    ".play-button",
    "[data-testid='play']",
    "video",
]


def die(msg: str, code: int = 1) -> None:
    print(json.dumps({"error": msg}), file=sys.stdout)
    raise SystemExit(code)


def title_from_m3u8(url: str) -> str:
    path = urlparse(url).path
    last = [p for p in path.split("/") if p][-1:] or ["stream"]
    name = re.sub(r"\.m3u8$", "", last[0], flags=re.I)
    name = re.sub(r"[-_]+", " ", name).strip()
    return (name or "stream")[:200]


def clean_title(raw: str | None) -> str | None:
    if not raw:
        return None
    t = unescape(re.sub(r"<[^>]+>", " ", raw))
    t = re.sub(r"\s+", " ", t).strip()
    t = re.sub(r"\s*[|\-–—].*$", "", t).strip() or t
    return t[:200] if t else None


def extract_title_from_soup(soup: BeautifulSoup, page_url: str) -> str | None:
    og = soup.find("meta", property="og:title") or soup.find(
        "meta", attrs={"name": "twitter:title"}
    )
    if og and og.get("content"):
        t = clean_title(og["content"])
        if t:
            return t
    if soup.title and soup.title.string:
        t = clean_title(soup.title.string)
        if t:
            return t
    h1 = soup.find("h1")
    if h1:
        t = clean_title(h1.get_text(" ", strip=True))
        if t:
            return t
    host = urlparse(page_url).hostname or "stream"
    return host.removeprefix("www.")


def normalize_candidate(raw: str, base: str) -> str | None:
    value = (
        raw.replace("\\u002F", "/")
        .replace("\\/", "/")
        .replace("&amp;", "&")
        .strip()
        .strip("\"'")
    )
    value = re.sub(r"[),.;]+$", "", value)
    low = value.lower()
    idx = low.find(".m3u8")
    if idx < 0:
        # allow m3u8 without extension in query? skip
        if "m3u8" not in low and "mpegurl" not in low:
            return None
    else:
        after = value[idx + 5 :]
        cut = re.search(r"[\"'\s<>\\]", after)
        if cut:
            value = value[: idx + 5 + cut.start()]
    try:
        resolved = urljoin(base, value)
        if ".m3u8" not in resolved.lower() and "mpegurl" not in resolved.lower():
            # still accept if looks like playlist endpoint
            if "m3u8" not in resolved.lower():
                return None
        return resolved
    except Exception:
        return None


def unique(seq: list[str]) -> list[str]:
    seen: set[str] = set()
    out: list[str] = []
    for x in seq:
        if x and x not in seen:
            seen.add(x)
            out.append(x)
    return out


def pick_best(candidates: list[str]) -> str | None:
    if not candidates:
        return None

    def score(c: str) -> tuple[int, int]:
        low = c.lower()
        s = 0
        if "master" in low:
            s += 3
        if "playlist" in low or "index" in low:
            s += 2
        if "chunklist" in low:
            s -= 1
        if "low" in low or "audio_only" in low:
            s -= 2
        return (s, -candidates.index(c))

    return max(candidates, key=score)


def find_m3u8s_in_text(html: str, base: str) -> list[str]:
    raw: list[str] = []
    raw.extend(M3U8_ABS_RE.findall(html or ""))
    for m in M3U8_ESC_RE.findall(html or ""):
        raw.append(m.replace("\\/", "/").replace("\\u0026", "&"))
    raw.extend(M3U8_REL_RE.findall(html or ""))
    try:
        soup = BeautifulSoup(html or "", "lxml")
        for tag in soup.find_all(True):
            for attr in (
                "src",
                "href",
                "data-src",
                "data-url",
                "data-stream",
                "data-file",
                "data-video",
                "data-hls",
                "data-source",
            ):
                v = tag.get(attr)
                if isinstance(v, str) and ("m3u8" in v.lower() or "mpegurl" in v.lower()):
                    raw.append(v)
    except Exception:
        pass

    out: list[str] = []
    for r in raw:
        n = normalize_candidate(r, base)
        if n:
            out.append(n)
    return unique(out)


def is_transient_network_error(exc: BaseException) -> bool:
    """SSL EOF / connection reset / temporary 5xx — worth retrying."""
    name = type(exc).__name__
    msg = str(exc).lower()
    needles = (
        "ssl",
        "tls",
        "eof",
        "connection reset",
        "connection aborted",
        "temporarily unavailable",
        "timed out",
        "timeout",
        "max retries exceeded",
        "remote end closed",
        "broken pipe",
        "10054",
        "104",
        "503",
        "502",
        "504",
        "429",
    )
    if any(n in msg for n in needles):
        return True
    if "SSL" in name or "Timeout" in name or "Connection" in name:
        return True
    # requests wraps urllib3
    cause = getattr(exc, "__cause__", None) or getattr(exc, "args", [None])[0]
    if cause is not None and cause is not exc:
        try:
            return is_transient_network_error(cause)  # type: ignore[arg-type]
        except Exception:
            pass
    return False


def fetch_page_html(url: str) -> tuple[requests.Response | None, list[str]]:
    """GET page HTML with retries for flaky TLS. Returns (response|None, warnings)."""
    warnings: list[str] = []
    last_err: Exception | None = None
    headers = {
        "User-Agent": UA,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Cache-Control": "no-cache",
        "Pragma": "no-cache",
        "Connection": "close",  # avoid stale keep-alive after CDN RST
    }
    for attempt in range(1, FETCH_ATTEMPTS + 1):
        try:
            res = requests.get(
                url,
                timeout=TIMEOUT,
                headers=headers,
                allow_redirects=True,
            )
            # Retry transient HTTP statuses
            if res.status_code in (429, 502, 503, 504) and attempt < FETCH_ATTEMPTS:
                warnings.append(
                    f"Page returned HTTP {res.status_code}; retry {attempt}/{FETCH_ATTEMPTS}…"
                )
                time.sleep(FETCH_BACKOFF_S[min(attempt - 1, len(FETCH_BACKOFF_S) - 1)])
                continue
            res.raise_for_status()
            if attempt > 1:
                warnings.append(f"Page fetch succeeded on attempt {attempt}/{FETCH_ATTEMPTS}.")
            return res, warnings
        except requests.Timeout as e:
            last_err = e
            if attempt < FETCH_ATTEMPTS:
                warnings.append(
                    f"Page timed out; retry {attempt}/{FETCH_ATTEMPTS}…"
                )
                time.sleep(FETCH_BACKOFF_S[min(attempt - 1, len(FETCH_BACKOFF_S) - 1)])
                continue
        except requests.RequestException as e:
            last_err = e
            if attempt < FETCH_ATTEMPTS and is_transient_network_error(e):
                warnings.append(
                    f"TLS/network glitch ({type(e).__name__}); "
                    f"retry {attempt}/{FETCH_ATTEMPTS}…"
                )
                time.sleep(FETCH_BACKOFF_S[min(attempt - 1, len(FETCH_BACKOFF_S) - 1)])
                continue
            # Non-transient — stop early
            if not is_transient_network_error(e):
                break
        except Exception as e:  # noqa: BLE001
            last_err = e
            if attempt < FETCH_ATTEMPTS and is_transient_network_error(e):
                warnings.append(
                    f"Fetch error ({type(e).__name__}); retry {attempt}/{FETCH_ATTEMPTS}…"
                )
                time.sleep(FETCH_BACKOFF_S[min(attempt - 1, len(FETCH_BACKOFF_S) - 1)])
                continue
            break

    warnings.append(
        f"Page request failed after {FETCH_ATTEMPTS} attempts: {last_err}"
    )
    return None, warnings


def static_extract(url: str) -> dict[str, Any]:
    warnings: list[str] = []
    if re.search(r"\.m3u8(\?|$)", url, re.I) or ".m3u8?" in url.lower():
        return {
            "pageUrl": url,
            "title": title_from_m3u8(url),
            "m3u8Url": url,
            "candidates": [url],
            "source": "direct",
            "warnings": warnings,
            "method": "direct",
        }

    res, fetch_warnings = fetch_page_html(url)
    warnings.extend(fetch_warnings)
    if res is None:
        # Soft-fail so caller can still try Playwright browser scrape
        return {
            "pageUrl": url,
            "title": None,
            "m3u8Url": None,
            "candidates": [],
            "source": "none",
            "warnings": warnings,
            "method": "static-failed",
            "fetchFailed": True,
        }

    ctype = (res.headers.get("content-type") or "").lower()
    text = res.text
    final_url = res.url

    if (
        "mpegurl" in ctype
        or "m3u8" in ctype
        or text.lstrip().startswith("#EXTM3U")
    ):
        return {
            "pageUrl": final_url,
            "title": title_from_m3u8(final_url),
            "m3u8Url": final_url,
            "candidates": [final_url],
            "source": "direct",
            "warnings": warnings,
            "method": "direct-body",
        }

    soup = BeautifulSoup(text, "lxml")
    title = extract_title_from_soup(soup, final_url)
    candidates = find_m3u8s_in_text(text, final_url)
    best = pick_best(candidates)

    if not candidates:
        warnings.append(
            "Static HTML had no .m3u8 links — will try headless browser (JS/network)."
        )

    return {
        "pageUrl": final_url,
        "title": title,
        "m3u8Url": best,
        "candidates": candidates,
        "source": "html" if candidates else "none",
        "warnings": warnings,
        "method": "static-html",
    }


def browser_extract(url: str) -> dict[str, Any]:
    """Deep scrape with Playwright: JS + network + iframes."""
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        return {
            "pageUrl": url,
            "title": None,
            "m3u8Url": None,
            "candidates": [],
            "source": "none",
            "warnings": [
                "Playwright is not installed. Run: pip install playwright && python -m playwright install chromium"
            ],
            "method": "browser-unavailable",
        }

    found: list[str] = []
    warnings: list[str] = []
    title: str | None = None
    final_url = url

    def consider(u: str | None, base: str = url) -> None:
        if not u:
            return
        # blob: and data: skip
        if u.startswith("blob:") or u.startswith("data:"):
            return
        n = normalize_candidate(u, base)
        if n:
            found.append(n)
        elif "m3u8" in u.lower() or "mpegurl" in u.lower():
            try:
                found.append(urljoin(base, u))
            except Exception:
                pass

    try:
      with sync_playwright() as p:
        try:
            browser = p.chromium.launch(
                headless=True,
                args=[
                    "--disable-blink-features=AutomationControlled",
                    "--no-sandbox",
                    "--disable-dev-shm-usage",
                    "--disable-gpu",
                ],
            )
        except Exception as launch_err:
            msg = str(launch_err)
            return {
                "pageUrl": url,
                "title": None,
                "m3u8Url": None,
                "candidates": [],
                "source": "none",
                "warnings": [
                    f"Browser launch failed: {msg}",
                    "Chromium binary missing. Rebuild Docker image (FORCE_BUILD=1 / run.bat). "
                    "Locally: python -m playwright install chromium",
                ],
                "method": "browser-launch-failed",
            }
        context = browser.new_context(
            user_agent=UA,
            viewport={"width": 1365, "height": 900},
            ignore_https_errors=True,
            java_script_enabled=True,
        )
        # Stealth-ish
        context.add_init_script(
            """
            Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
            window.chrome = { runtime: {} };
            """
        )
        page = context.new_page()

        def on_request(req) -> None:
            try:
                u = req.url
                rt = (req.resource_type or "").lower()
                headers = {k.lower(): v for k, v in (req.headers or {}).items()}
                accept = headers.get("accept", "")
                if (
                    ".m3u8" in u.lower()
                    or "mpegurl" in accept.lower()
                    or "mpegurl" in u.lower()
                    or (rt in ("media", "xhr", "fetch") and "m3u8" in u.lower())
                ):
                    consider(u, page.url)
            except Exception:
                pass

        def on_response(resp) -> None:
            try:
                u = resp.url
                ct = (resp.headers or {}).get("content-type", "").lower()
                if (
                    ".m3u8" in u.lower()
                    or "mpegurl" in ct
                    or "x-mpegurl" in ct
                    or "apple.mpegurl" in ct
                ):
                    consider(u, page.url)
            except Exception:
                pass

        page.on("request", on_request)
        page.on("response", on_response)

        navigated = False
        for attempt in range(1, FETCH_ATTEMPTS + 1):
            try:
                page.goto(
                    url, wait_until="domcontentloaded", timeout=BROWSER_TIMEOUT_MS
                )
                navigated = True
                if attempt > 1:
                    warnings.append(
                        f"Browser navigation succeeded on attempt {attempt}/{FETCH_ATTEMPTS}."
                    )
                break
            except Exception as e:
                if attempt < FETCH_ATTEMPTS and is_transient_network_error(e):
                    warnings.append(
                        f"Browser TLS/nav glitch; retry {attempt}/{FETCH_ATTEMPTS}…"
                    )
                    time.sleep(
                        FETCH_BACKOFF_S[min(attempt - 1, len(FETCH_BACKOFF_S) - 1)]
                    )
                    continue
                warnings.append(f"Initial navigation warning: {e}")
                break

        if not navigated:
            warnings.append(
                "Browser could not fully load the page; scraping what we can."
            )

        final_url = page.url

        # Wait for network to settle a bit (players often fetch after load)
        try:
            page.wait_for_load_state("networkidle", timeout=15_000)
        except Exception:
            warnings.append("networkidle wait timed out — continuing with partial load")

        time.sleep(1.5)

        # Try clicking play controls to trigger HLS loaders
        for sel in PLAY_SELECTORS:
            try:
                loc = page.locator(sel).first
                if loc.count() > 0:
                    loc.click(timeout=1500, force=True)
                    time.sleep(1.2)
            except Exception:
                continue

        # Extra settle after interaction
        try:
            page.wait_for_timeout(2500)
        except Exception:
            pass

        # DOM + iframe HTML scrape
        def scrape_frame(frame) -> str:
            try:
                return frame.content()
            except Exception:
                return ""

        html_chunks: list[str] = []
        for frame in page.frames:
            html_chunks.append(scrape_frame(frame))
            # frame url as base for relative
            try:
                furl = frame.url or final_url
                for c in find_m3u8s_in_text(html_chunks[-1], furl):
                    found.append(c)
            except Exception:
                pass

        # JS evaluation: performance resources + common player globals
        try:
            js_hits = page.evaluate(
                """() => {
                  const out = [];
                  try {
                    const entries = performance.getEntriesByType('resource') || [];
                    for (const e of entries) {
                      if (e && e.name && /m3u8|mpegurl/i.test(e.name)) out.push(e.name);
                    }
                  } catch {}
                  const push = (v) => {
                    if (!v) return;
                    if (typeof v === 'string') out.push(v);
                    else if (Array.isArray(v)) v.forEach(push);
                    else if (typeof v === 'object') {
                      for (const k of Object.keys(v)) {
                        if (/src|url|file|source|hls|playlist/i.test(k)) push(v[k]);
                      }
                    }
                  };
                  try { if (window.videojs) {
                    document.querySelectorAll('video-js, .video-js').forEach(el => {
                      try { const p = el.player || (window.videojs && window.videojs.getPlayer && window.videojs.getPlayer(el));
                        if (p && p.currentSrc) push(p.currentSrc());
                        if (p && p.cache_ && p.cache_.source) push(p.cache_.source);
                      } catch {}
                    });
                  }} catch {}
                  try {
                    document.querySelectorAll('video, source, [data-src], [data-hls], [data-file]').forEach(el => {
                      push(el.src || el.getAttribute('src'));
                      push(el.getAttribute('data-src'));
                      push(el.getAttribute('data-hls'));
                      push(el.getAttribute('data-file'));
                      push(el.getAttribute('data-url'));
                    });
                  } catch {}
                  return Array.from(new Set(out.filter(Boolean)));
                }"""
            )
            if isinstance(js_hits, list):
                for h in js_hits:
                    consider(str(h), final_url)
        except Exception as e:
            warnings.append(f"JS evaluation partial: {e}")

        # Title
        try:
            title = clean_title(page.title())
        except Exception:
            title = None
        try:
            og = page.locator("meta[property='og:title']").first
            if og.count() > 0:
                content = og.get_attribute("content")
                t = clean_title(content)
                if t:
                    title = t
        except Exception:
            pass

        # One more short wait for late XHR
        try:
            page.wait_for_timeout(1500)
        except Exception:
            pass

        context.close()
        browser.close()
    except Exception as e:
        return {
            "pageUrl": url,
            "title": None,
            "m3u8Url": None,
            "candidates": [],
            "source": "none",
            "warnings": [
                f"Browser scrape error: {e}",
                "Falling back to static HTML results if any.",
            ],
            "method": "browser-error",
        }

    candidates = unique(found)
    best = pick_best(candidates)
    if not candidates:
        warnings.append(
            "Headless browser found no .m3u8 network/DOM hits. "
            "The stream may need login, DRM, or a non-HLS protocol."
        )

    return {
        "pageUrl": final_url,
        "title": title or (title_from_m3u8(best) if best else None),
        "m3u8Url": best,
        "candidates": candidates,
        "source": "browser" if candidates else "none",
        "warnings": warnings,
        "method": "playwright-network+iframes",
    }


def extract(url: str, deep: bool = False, no_browser: bool = False) -> dict[str, Any]:
    url = url.strip()
    if not re.match(r"^https?://", url, re.I):
        die("Only http and https URLs are supported")

    static = static_extract(url)

    # Direct hits never need browser
    if static.get("source") == "direct":
        return static

    has_static = bool(static.get("candidates"))
    fetch_failed = bool(static.get("fetchFailed"))

    if no_browser:
        if fetch_failed:
            die(
                (static.get("warnings") or ["Page request failed"])[-1]
                if static.get("warnings")
                else "Page request failed"
            )
        if not has_static:
            static["warnings"] = list(static.get("warnings") or []) + [
                "Browser scrape disabled (--no-browser)."
            ]
        return static

    # Use browser when static empty/failed, or when --deep requested
    if has_static and not deep and not fetch_failed:
        static["warnings"] = list(static.get("warnings") or []) + [
            "Found via static HTML. Re-run with deep browser mode if these are wrong."
        ]
        return static

    if fetch_failed:
        static["warnings"] = list(static.get("warnings") or []) + [
            "Static fetch failed after retries — trying headless browser…"
        ]

    browser = browser_extract(url)

    # Merge candidates from static + browser
    merged = unique(
        list(static.get("candidates") or []) + list(browser.get("candidates") or [])
    )
    title = browser.get("title") or static.get("title")
    best = pick_best(merged)
    warnings = list(static.get("warnings") or []) + list(browser.get("warnings") or [])
    source = (
        "browser"
        if browser.get("source") == "browser"
        else ("html" if merged else "none")
    )

    if has_static and browser.get("source") == "browser":
        warnings.append(
            f"Deep browser scrape merged results "
            f"(static={len(static.get('candidates') or [])}, "
            f"browser={len(browser.get('candidates') or [])})."
        )

    if not merged and fetch_failed:
        # Nothing from static or browser — surface the original TLS error
        err = next(
            (w for w in warnings if "failed after" in w.lower() or "ssl" in w.lower()),
            warnings[-1] if warnings else "Extract failed (network)",
        )
        die(err)

    return {
        "pageUrl": browser.get("pageUrl") or static.get("pageUrl") or url,
        "title": title,
        "m3u8Url": best,
        "candidates": merged,
        "source": source if merged else "none",
        "warnings": warnings,
        "method": browser.get("method") or static.get("method"),
    }


def main() -> None:
    p = argparse.ArgumentParser(description="Extract m3u8 + title from a URL")
    p.add_argument("--url", required=True, help="Page or m3u8 URL")
    p.add_argument(
        "--deep",
        action="store_true",
        help="Always run headless browser (JS + network + iframes)",
    )
    p.add_argument(
        "--no-browser",
        action="store_true",
        help="Disable Playwright; static HTML only",
    )
    args = p.parse_args()
    result = extract(args.url, deep=args.deep, no_browser=args.no_browser)
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
