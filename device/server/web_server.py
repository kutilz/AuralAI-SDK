"""
Web Server — HTTP server yang serve dashboard dan API endpoints.
Berjalan di Thread 2 (selalu aktif).
"""

import json
import os
import threading
from http.server import HTTPServer, BaseHTTPRequestHandler
from functools import partial


STATIC_DIR = os.path.join(os.path.dirname(__file__), "static")


class AuralAIHandler(BaseHTTPRequestHandler):
    """HTTP request handler untuk semua endpoint AuralAI."""

    def __init__(self, orchestrator, logger, *args, **kwargs):
        self.orch = orchestrator
        self.logger = logger
        super().__init__(*args, **kwargs)

    def log_message(self, format, *args):
        # Suppress default HTTPServer logging — gunakan logger kita
        pass

    def do_GET(self):
        path = self.path.split("?")[0]

        if path == "/" or path == "/index.html":
            self._serve_file("index.html", "text/html")
        elif path == "/style.css":
            self._serve_file("style.css", "text/css")
        elif path == "/dashboard.js":
            self._serve_file("dashboard.js", "application/javascript")
        elif path == "/snapshot":
            self._serve_snapshot()
        elif path == "/status":
            self._serve_status()
        elif path == "/logs":
            self._serve_logs()
        elif path.startswith("/audio/"):
            self._serve_audio(path[7:])
        else:
            self._send_404()

    def do_POST(self):
        path = self.path.split("?")[0]

        if path == "/command":
            self._handle_command()
        elif path == "/config":
            self._handle_config()
        else:
            self._send_404()

    def do_OPTIONS(self):
        # CORS preflight
        self.send_response(200)
        self._set_cors_headers()
        self.end_headers()

    def _set_cors_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")

    # ─── Endpoints ────────────────────────────────────────────────────────────

    def _serve_file(self, filename, content_type):
        filepath = os.path.join(STATIC_DIR, filename)
        try:
            with open(filepath, "rb") as f:
                data = f.read()
            self.send_response(200)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", len(data))
            self._set_cors_headers()
            self.end_headers()
            self.wfile.write(data)
        except FileNotFoundError:
            self._send_404()

    def _serve_snapshot(self):
        snap = self.orch.snapshot
        if snap is None:
            self._send_404()
            return
        self.send_response(200)
        self.send_header("Content-Type", "image/jpeg")
        self.send_header("Content-Length", len(snap))
        self.send_header("Cache-Control", "no-cache, no-store, must-revalidate")
        self._set_cors_headers()
        self.end_headers()
        self.wfile.write(snap)

    def _serve_status(self):
        status = self.orch.get_status()

        # Tambah audio text jika ada
        audio = self.orch.pop_audio()
        if audio:
            status["audio_text"] = audio

        self._send_json(status)

    def _serve_logs(self):
        logs = self.orch.logger.get_recent(50)
        self._send_json({"logs": logs})

    def _serve_audio(self, filename):
        from config import AUDIO_DIR
        filepath = os.path.join(AUDIO_DIR, filename)
        try:
            with open(filepath, "rb") as f:
                data = f.read()
            self.send_response(200)
            self.send_header("Content-Type", "audio/wav")
            self.send_header("Content-Length", len(data))
            self._set_cors_headers()
            self.end_headers()
            self.wfile.write(data)
        except FileNotFoundError:
            self._send_404()

    def _handle_command(self):
        try:
            length = int(self.headers.get("Content-Length", 0))
            body = self.rfile.read(length)
            data = json.loads(body)

            cmd = data.get("cmd")
            if not cmd:
                self._send_json({"error": "missing cmd"}, 400)
                return

            valid_cmds = {"focus", "capture", "qris", "describe", "set_mode"}
            if cmd not in valid_cmds:
                self._send_json({"error": f"unknown cmd: {cmd}"}, 400)
                return

            self.orch.set_pending_command(cmd, data)
            self.logger.info(f"Command received: {cmd}")
            self._send_json({"ok": True, "cmd": cmd})

        except Exception as e:
            self.logger.error(f"Command error: {e}")
            self._send_json({"error": str(e)}, 500)

    def _handle_config(self):
        try:
            length = int(self.headers.get("Content-Length", 0))
            body = self.rfile.read(length)
            data = json.loads(body)
            # Config update (bisa dikembangkan)
            self.logger.info(f"Config update: {data}")
            self._send_json({"ok": True})
        except Exception as e:
            self._send_json({"error": str(e)}, 500)

    # ─── Helpers ──────────────────────────────────────────────────────────────

    def _send_json(self, data, status=200):
        body = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", len(body))
        self._set_cors_headers()
        self.end_headers()
        self.wfile.write(body)

    def _send_404(self):
        self._send_json({"error": "not found"}, 404)


class WebServer:
    def __init__(self, host, port, orchestrator, logger):
        self.host = host
        self.port = port
        self.orch = orchestrator
        self.logger = logger

    def start(self):
        handler = partial(AuralAIHandler, self.orch, self.logger)
        server = HTTPServer((self.host, self.port), handler)
        self.logger.ok(f"Web server listening on {self.host}:{self.port}")
        server.serve_forever()
