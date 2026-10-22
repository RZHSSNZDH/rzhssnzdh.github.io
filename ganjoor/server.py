#!/usr/bin/env python3
"""Serve Ganjoorand and (only if needed) proxy the Ganjoor API.

No third-party packages: Python's standard library is all it takes.

    python3 server.py              # http://127.0.0.1:8000
    python3 server.py -p 9000      # another port
    python3 server.py --open       # also open the browser

The browser first tries api.ganjoor.net directly. If CORS blocks that, it
falls back to /gapi/..., which this server forwards to the Ganjoor API.
Only that one upstream host is ever contacted.
"""

from __future__ import annotations

import argparse
import threading
import webbrowser
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import quote
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parent
UPSTREAM = "https://api.ganjoor.net/api/ganjoor"
PREFIX = "/gapi"
USER_AGENT = "Ganjoorand-Web/1.0 (+https://ganjoor.net)"
TIMEOUT = 25


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def do_GET(self) -> None:  # noqa: N802 (stdlib naming)
        if self.path.startswith(PREFIX + "/"):
            self._proxy()
        else:
            super().do_GET()

    def end_headers(self) -> None:
        # Always serve fresh files while hacking on the app.
        if not self.path.startswith(PREFIX + "/"):
            self.send_header("Cache-Control", "no-cache")
        super().end_headers()

    def _reply(self, status: int, body: bytes, content_type: str) -> None:
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("X-Ganjoor-Proxy", "1")
        self.end_headers()
        self.wfile.write(body)

    def _proxy(self) -> None:
        tail = quote(self.path[len(PREFIX):], safe="/?=&%:,+")
        req = Request(
            UPSTREAM + tail,
            headers={"User-Agent": USER_AGENT, "Accept": "application/json"},
        )
        try:
            with urlopen(req, timeout=TIMEOUT) as res:
                self._reply(
                    res.status,
                    res.read(),
                    res.headers.get("Content-Type", "application/json"),
                )
        except HTTPError as exc:
            self._reply(
                exc.code,
                exc.read() or b"{}",
                exc.headers.get("Content-Type", "application/json"),
            )
        except (URLError, TimeoutError, OSError) as exc:
            msg = f'{{"error": "upstream unreachable: {type(exc).__name__}"}}'
            self._reply(502, msg.encode(), "application/json")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("-p", "--port", type=int, default=8000)
    parser.add_argument("-b", "--bind", default="127.0.0.1")
    parser.add_argument("--open", action="store_true", help="open the browser")
    args = parser.parse_args()

    server = ThreadingHTTPServer((args.bind, args.port), Handler)
    url = f"http://{args.bind}:{args.port}/"
    print(f"گنجورند  ·  {url}   (Ctrl+C to stop)")
    if args.open:
        threading.Timer(0.4, webbrowser.open, args=(url,)).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nbye")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
