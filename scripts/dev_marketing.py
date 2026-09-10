#!/usr/bin/env python3
"""Serve the marketing site locally with the same routing production has.

In production one static site serves everything (see render.yaml): the
marketing pages at /, the admin portal at /admin-portal, and the operator
console at /login + /console/* via rewrites. A bare `python -m http.server`
has no rewrites, so the header "Log in" button 404s locally and the console
is unreachable from the marketing site.

This server fills that gap for local development: it serves `marketing/`
and redirects /login and /console* to the Vite dev server (default
http://localhost:5173), where the console runs at root in dev.

Usage:
    python scripts/dev_marketing.py            # http://localhost:8090
    PORT=8091 CONSOLE_URL=http://localhost:5174 python scripts/dev_marketing.py
"""

from __future__ import annotations

import os
import sys
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent / "marketing"
PORT = int(os.environ.get("PORT", "8090"))
CONSOLE_URL = os.environ.get("CONSOLE_URL", "http://localhost:5173").rstrip("/")

# Paths that production rewrites to the console SPA.
CONSOLE_PREFIXES = ("/login", "/console")


class Handler(SimpleHTTPRequestHandler):
    def do_GET(self) -> None:  # noqa: N802 (http.server naming)
        path = self.path.split("?", 1)[0]
        for prefix in CONSOLE_PREFIXES:
            if path == prefix or path.startswith(prefix + "/"):
                self.send_response(302)
                self.send_header("Location", CONSOLE_URL + self.path)
                self.send_header("Cache-Control", "no-store")
                self.end_headers()
                return
        super().do_GET()

    def end_headers(self) -> None:
        # Never let the browser cache dev assets between edits.
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def log_message(self, fmt: str, *args) -> None:
        # Quiet successful static hits; keep redirects and errors visible.
        if args and str(args[1]) in ("200", "304"):
            return
        super().log_message(fmt, *args)


def main() -> int:
    if not ROOT.is_dir():
        print(f"marketing directory not found at {ROOT}", file=sys.stderr)
        return 1
    handler = partial(Handler, directory=str(ROOT))
    with ThreadingHTTPServer(("", PORT), handler) as httpd:
        print(f"marketing  http://localhost:{PORT}/")
        print(f"admin      http://localhost:{PORT}/admin-portal/")
        print(f"/login and /console/* -> {CONSOLE_URL}")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            pass
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
