#!/usr/bin/env python3
"""Probe an m3u8 URL for master playlist variants (resolutions).

Usage:
  python probe_stream.py --url "https://.../master.m3u8"
  python probe_stream.py --url "..." --referer "https://site.com/watch/1"
  # JSON on stdout
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from urllib.parse import urljoin

import requests

from stream_headers import browser_headers, explain_http_error

TIMEOUT = 20


def die(msg: str, code: int = 1) -> None:
    print(json.dumps({"error": explain_http_error(msg)}))
    raise SystemExit(code)


def fetch_text(url: str, referer: str | None = None) -> str:
    try:
        r = requests.get(
            url,
            timeout=TIMEOUT,
            headers=browser_headers(url, referer=referer),
            allow_redirects=True,
        )
        r.raise_for_status()
        return r.text
    except requests.Timeout:
        die("Timed out probing stream (20s)")
    except requests.RequestException as e:
        die(f"Failed to fetch playlist: {e}")
    return ""


def parse_variants(master_url: str, text: str) -> list[dict]:
    lines = [ln.strip() for ln in text.splitlines() if ln.strip()]
    variants: list[dict] = []
    i = 0
    while i < len(lines):
        line = lines[i]
        if line.startswith("#EXT-X-STREAM-INF:"):
            info = line[len("#EXT-X-STREAM-INF:") :]
            attrs: dict[str, str] = {}
            for part in re.findall(
                r'([A-Z0-9-]+)=(".*?"|[^,]*)', info, flags=re.I
            ):
                key, val = part[0].upper(), part[1].strip().strip('"')
                attrs[key] = val
            j = i + 1
            while j < len(lines) and lines[j].startswith("#"):
                j += 1
            if j < len(lines):
                uri = lines[j]
                full = urljoin(master_url, uri)
                bw = attrs.get("BANDWIDTH") or attrs.get("AVERAGE-BANDWIDTH")
                res = attrs.get("RESOLUTION")
                codecs = attrs.get("CODECS")
                try:
                    bw_i = int(bw) if bw else None
                except ValueError:
                    bw_i = None
                label_parts = []
                if res:
                    label_parts.append(res)
                if bw_i:
                    if bw_i >= 1_000_000:
                        label_parts.append(f"{bw_i / 1_000_000:.1f} Mbps")
                    else:
                        label_parts.append(f"{bw_i // 1000} kbps")
                if not label_parts:
                    label_parts.append(f"variant {len(variants) + 1}")
                variants.append(
                    {
                        "id": f"v{len(variants)}",
                        "url": full,
                        "bandwidth": bw_i,
                        "resolution": res,
                        "codecs": codecs,
                        "label": " · ".join(label_parts),
                    }
                )
                i = j
        i += 1
    variants.sort(key=lambda v: v.get("bandwidth") or 0, reverse=True)
    return variants


def probe(url: str, referer: str | None = None) -> dict:
    url = url.strip()
    if not re.match(r"^https?://", url, re.I):
        die("Only http(s) URLs are supported")

    text = fetch_text(url, referer=referer)
    warnings: list[str] = []

    if "#EXT-X-STREAM-INF" in text:
        variants = parse_variants(url, text)
        if not variants:
            warnings.append("Master playlist found but no variants parsed.")
            return {
                "url": url,
                "isMaster": True,
                "variants": [
                    {
                        "id": "default",
                        "url": url,
                        "bandwidth": None,
                        "resolution": None,
                        "codecs": None,
                        "label": "Default / auto",
                    }
                ],
                "warnings": warnings,
            }
        return {
            "url": url,
            "isMaster": True,
            "variants": variants,
            "warnings": warnings,
        }

    return {
        "url": url,
        "isMaster": False,
        "variants": [
            {
                "id": "default",
                "url": url,
                "bandwidth": None,
                "resolution": None,
                "codecs": None,
                "label": "Single stream",
            }
        ],
        "warnings": warnings,
    }


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--url", required=True)
    p.add_argument("--referer", default="")
    args = p.parse_args()
    ref = (args.referer or "").strip() or None
    print(json.dumps(probe(args.url, referer=ref), ensure_ascii=False))


if __name__ == "__main__":
    main()
