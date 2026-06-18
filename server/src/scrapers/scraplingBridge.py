#!/usr/bin/env python3
"""Small JSON bridge used by the TypeScript scraper adapter.

This keeps Scrapling as an optional runtime dependency. The Node scraper layer
passes a URL and receives rendered HTML, while all domain extraction remains in
TypeScript.
"""

from __future__ import annotations

import argparse
import json
import sys


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", required=True)
    parser.add_argument("--mode", choices=["dynamic", "stealthy"], default="dynamic")
    parser.add_argument("--timeout-ms", type=int, default=30000)
    parser.add_argument("--wait-selector", default=None)
    args = parser.parse_args()

    try:
        from scrapling.fetchers import DynamicFetcher, StealthyFetcher
    except Exception as exc:  # pragma: no cover - exercised from Node in prod
        return fail(f"scrapling-import-failed: {exc}")

    fetcher = StealthyFetcher if args.mode == "stealthy" else DynamicFetcher
    kwargs = {
        "headless": True,
        "network_idle": True,
        "timeout": args.timeout_ms,
        "disable_resources": True,
    }
    if args.wait_selector:
        kwargs["wait_selector"] = args.wait_selector

    try:
        page = fetcher.fetch(args.url, **kwargs)
        body = getattr(page, "body", b"") or b""
        encoding = getattr(page, "encoding", None) or "utf-8"
        html = body.decode(encoding, errors="replace") if isinstance(body, bytes) else str(body)
        output = {
            "url": getattr(page, "url", None) or args.url,
            "statusCode": getattr(page, "status", None),
            "html": html,
            "blocked": is_blocked(html, getattr(page, "status", None)),
            "blockedReason": blocked_reason(html, getattr(page, "status", None)),
        }
        print(json.dumps(output))
        return 0
    except Exception as exc:  # pragma: no cover - exercised from Node in prod
        return fail(f"scrapling-fetch-failed: {exc}")


def is_blocked(html: str, status: int | None) -> bool:
    reason = blocked_reason(html, status)
    return reason is not None


def blocked_reason(html: str, status: int | None) -> str | None:
    text = (html or "").lower()
    if status in {401, 403, 429, 503}:
        return f"http-{status}"
    if "cf-challenge" in text or "cloudflare" in text and "challenge" in text:
        return "cloudflare-challenge"
    if "captcha" in text or "turnstile" in text:
        return "captcha-or-turnstile"
    if "access denied" in text:
        return "access-denied"
    return None


def fail(message: str) -> int:
    print(json.dumps({"html": "", "blocked": False, "blockedReason": message}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
