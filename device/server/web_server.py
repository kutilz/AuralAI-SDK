"""
Web Server — HTTP server yang serve dashboard dan API endpoints.
Berjalan di Thread 2 (selalu aktif).
"""

import json
import os
import signal
import subprocess
import sys
import threading
from http.server import HTTPServer, BaseHTTPRequestHandler
from functools import partial


STATIC_DIR = os.path.join(os.path.dirname(__file__), "static")
_DEVICE_DIR = os.path.dirname(os.path.dirname(__file__))


# ─── Benchmark Runner ──────────────────────────────────────────────────────────

class BenchmarkRunner:
    STATUS_FILE = '/tmp/benchmark_progress.json'

    def __init__(self):
        self._proc = None
        self._lock = threading.Lock()

    def start(self, section=None):
        with self._lock:
            if self._proc and self._proc.poll() is None:
                return False, 'Already running'
            try:
                # Clear old progress
                try:
                    with open(self.STATUS_FILE, 'w') as f:
                        json.dump({'running': True, 'section': -1, 'lines': [], 'results': {}}, f)
                except Exception:
                    pass

                script = os.path.join(_DEVICE_DIR, 'benchmark.py')
                args   = [sys.executable, script]
                if section is not None:
                    args += ['--section', str(section)]
                self._proc = subprocess.Popen(
                    args,
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL,
                    cwd=_DEVICE_DIR,
                )
                return True, f'Started PID {self._proc.pid}'
            except Exception as e:
                return False, str(e)

    def stop(self):
        with self._lock:
            if self._proc and self._proc.poll() is None:
                self._proc.terminate()
                return True, 'Stopped'
            return False, 'Not running'

    def status(self):
        with self._lock:
            proc_running = self._proc is not None and self._proc.poll() is None
        try:
            with open(self.STATUS_FILE) as f:
                data = json.load(f)
            # proc is authoritative for running state
            data['running'] = proc_running or data.get('running', False)
            return data
        except Exception:
            return {'running': proc_running, 'section': -1, 'lines': [], 'results': {}}


# ─── Stress Runner ─────────────────────────────────────────────────────────────

class StressRunner:
    STATUS_FILE = '/tmp/overnight_status.json'
    STOP_FILE   = '/tmp/overnight_stop'
    PID_FILE    = '/tmp/overnight_pid'

    def start(self, hours=3):
        # Check if already running via pid file
        if os.path.exists(self.PID_FILE):
            try:
                with open(self.PID_FILE) as f:
                    pid = int(f.read().strip())
                os.kill(pid, 0)  # raises if dead
                return False, f'Already running (PID {pid})'
            except (ProcessLookupError, ValueError, OSError):
                pass  # stale pid file

        try: os.remove(self.STOP_FILE)
        except FileNotFoundError: pass

        script = os.path.join(_DEVICE_DIR, 'overnight_stress.py')
        proc   = subprocess.Popen(
            [sys.executable, script, '--hours', str(hours)],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            cwd=_DEVICE_DIR,
            start_new_session=True,
        )
        try:
            with open(self.PID_FILE, 'w') as f:
                f.write(str(proc.pid))
        except Exception:
            pass
        return True, f'Started PID {proc.pid}'

    def stop(self):
        try: open(self.STOP_FILE, 'w').close()
        except Exception: pass
        try:
            if os.path.exists(self.PID_FILE):
                with open(self.PID_FILE) as f:
                    pid = int(f.read().strip())
                os.kill(pid, signal.SIGTERM)
        except Exception:
            pass
        return True, 'Stop signal sent'

    def status(self):
        try:
            with open(self.STATUS_FILE) as f:
                return json.load(f)
        except Exception:
            return {
                'running': False, 'elapsed_s': 0, 'fps': 0.0,
                'temp_c': 0.0, 'ram_free_mb': 0,
                'throttle_events': 0, 'frames_total': 0,
            }


# ─── Benchmark Suite Runner ────────────────────────────────────────────────────

class BenchmarkSuiteRunner:
    """
    Runs the standardized 4-test benchmark suite as a subprocess.
    Results are readable from /tmp/bench_suite_progress.json while running,
    and from /root/logs/safety_index_report.json when done.
    """
    PROGRESS_FILE = "/tmp/bench_suite_progress.json"
    REPORT_FILE   = "/root/logs/safety_index_report.json"

    def __init__(self):
        self._proc = None
        self._lock = threading.Lock()

    def start(self, tests="T1,T2,T3,T4", t1_frames=100, t4_duration=600):
        with self._lock:
            if self._proc and self._proc.poll() is None:
                return False, "Already running"
            try:
                script = os.path.join(_DEVICE_DIR, "benchmark", "run_all.py")
                args   = [
                    sys.executable, script,
                    "--tests",       tests,
                    "--t1-frames",   str(t1_frames),
                    "--t4-duration", str(t4_duration),
                ]
                self._proc = subprocess.Popen(
                    args,
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL,
                    cwd=_DEVICE_DIR,
                )
                return True, f"Suite started (PID {self._proc.pid})"
            except Exception as e:
                return False, str(e)

    def report_only(self):
        with self._lock:
            if self._proc and self._proc.poll() is None:
                return False, "Suite running — wait for it to finish"
            try:
                script = os.path.join(_DEVICE_DIR, "benchmark", "run_all.py")
                subprocess.Popen(
                    [sys.executable, script, "--report-only"],
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL,
                    cwd=_DEVICE_DIR,
                )
                return True, "Report compilation started"
            except Exception as e:
                return False, str(e)

    def stop(self):
        with self._lock:
            if self._proc and self._proc.poll() is None:
                self._proc.terminate()
                return True, "Stopped"
        return False, "Not running"

    def progress(self):
        running = self._proc is not None and self._proc.poll() is None
        try:
            with open(self.PROGRESS_FILE) as f:
                data = json.load(f)
            data["proc_running"] = running
            return data
        except Exception:
            return {"running": running, "step": "idle", "pct": 0, "results": {}}

    def report(self):
        try:
            with open(self.REPORT_FILE) as f:
                return json.load(f)
        except Exception:
            return None


# ─── Module-level singletons ───────────────────────────────────────────────────
_benchmark = BenchmarkRunner()
_stress    = StressRunner()
_suite     = BenchmarkSuiteRunner()


# ─── Request Handler ───────────────────────────────────────────────────────────

class AuralAIHandler(BaseHTTPRequestHandler):
    """HTTP request handler untuk semua endpoint AuralAI."""

    def __init__(self, orchestrator, logger, data_collector, *args, **kwargs):
        self.orch = orchestrator
        self.logger = logger
        self.dc = data_collector
        super().__init__(*args, **kwargs)

    def log_message(self, format, *args):
        pass  # suppress default HTTPServer logging

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
        elif path == "/health":
            self._serve_health()
        elif path.startswith("/audio/"):
            self._serve_audio(path[7:])
        # ── Benchmark endpoints ────────────────────────────────────────────────
        elif path == "/benchmark/status":
            self._send_json(_benchmark.status())
        # ── Stress endpoints ───────────────────────────────────────────────────
        elif path == "/stress/status":
            self._send_json(_stress.status())
        # ── Benchmark Suite endpoints ──────────────────────────────────────────
        elif path == "/suite/progress":
            self._send_json(_suite.progress())
        elif path == "/suite/report":
            r = _suite.report()
            if r:
                self._send_json(r)
            else:
                self._send_json({"error": "Report not available — run suite first"}, 404)
        # ── Data Collection endpoints ──────────────────────────────────────────
        elif path == "/collect" or path == "/collect/":
            self._serve_file("collect.html", "text/html")
        elif path == "/collect/status":
            self._serve_collect_status()
        elif path == "/collect/gallery":
            self._serve_collect_gallery()
        elif path.startswith("/collect/photo/"):
            self._serve_collect_photo(path[len("/collect/photo/"):])
        elif path == "/ai-settings":
            self._serve_ai_settings()
        else:
            self._send_404()

    def do_POST(self):
        path = self.path.split("?")[0]

        if path == "/command":
            self._handle_command()
        elif path == "/config":
            self._handle_config()
        # ── Benchmark ─────────────────────────────────────────────────────────
        elif path == "/benchmark/run":
            self._handle_benchmark_run()
        elif path == "/benchmark/stop":
            ok, msg = _benchmark.stop()
            self._send_json({"ok": ok, "message": msg})
        # ── Stress ────────────────────────────────────────────────────────────
        elif path == "/stress/start":
            self._handle_stress_start()
        elif path == "/stress/stop":
            ok, msg = _stress.stop()
            self._send_json({"ok": ok, "message": msg})
        # ── Benchmark Suite ───────────────────────────────────────────────
        elif path == "/suite/start":
            self._handle_suite_start()
        elif path == "/suite/stop":
            ok, msg = _suite.stop()
            self._send_json({"ok": ok, "message": msg})
        elif path == "/suite/report-only":
            ok, msg = _suite.report_only()
            self._send_json({"ok": ok, "message": msg})
        # ── Data Collection ───────────────────────────────────────────────────
        elif path == "/collect/start":
            self._handle_collect_start()
        elif path == "/collect/stop":
            self._handle_collect_stop()
        elif path == "/ai-settings":
            self._handle_ai_settings_save()
        elif path == "/ai-settings/test":
            self._handle_ai_settings_test()
        else:
            self._send_404()

    def do_OPTIONS(self):
        self.send_response(200)
        self._set_cors_headers()
        self.end_headers()

    def _set_cors_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")

    # ─── Core endpoints ────────────────────────────────────────────────────────

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
        self._send_json(self.orch.get_status())

    def _serve_logs(self):
        logs = self.orch.logger.get_recent(50)
        self._send_json({"logs": logs})

    def _serve_health(self):
        try:
            from utils.health import get_health
            self._send_json(get_health())
        except Exception as e:
            self._send_json({"error": str(e)}, 500)

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
            body   = self.rfile.read(length)
            data   = json.loads(body)
            from config import cfg
            cfg.update(data)
            self.logger.info(f"Config updated: {list(data.keys())}")
            self._send_json({"ok": True, "applied": list(data.keys())})
        except Exception as e:
            self._send_json({"error": str(e)}, 500)

    # ─── Benchmark Suite endpoints ─────────────────────────────────────────────

    def _handle_suite_start(self):
        try:
            length = int(self.headers.get("Content-Length", 0))
            data   = json.loads(self.rfile.read(length)) if length else {}
            tests      = data.get("tests",       "T1,T2,T3,T4")
            t1_frames  = int(data.get("t1_frames",  100))
            t4_duration = float(data.get("t4_duration", 600))
            ok, msg = _suite.start(tests=tests, t1_frames=t1_frames,
                                   t4_duration=t4_duration)
            self._send_json({"ok": ok, "message": msg})
        except Exception as e:
            self._send_json({"error": str(e)}, 500)

    # ─── Benchmark endpoints ───────────────────────────────────────────────────

    def _handle_benchmark_run(self):
        try:
            length = int(self.headers.get("Content-Length", 0))
            data   = json.loads(self.rfile.read(length)) if length else {}
            section = data.get("section")  # None = all sections
            ok, msg = _benchmark.start(section)
            self._send_json({"ok": ok, "message": msg})
        except Exception as e:
            self._send_json({"error": str(e)}, 500)

    # ─── Stress endpoints ──────────────────────────────────────────────────────

    def _handle_stress_start(self):
        try:
            length = int(self.headers.get("Content-Length", 0))
            data   = json.loads(self.rfile.read(length)) if length else {}
            hours  = float(data.get("hours", 3))
            ok, msg = _stress.start(hours)
            self._send_json({"ok": ok, "message": msg})
        except Exception as e:
            self._send_json({"error": str(e)}, 500)

    # ─── Data Collection endpoints ─────────────────────────────────────────────

    def _serve_collect_status(self):
        if self.dc is None:
            self._send_json({"error": "data collector not available"}, 503)
            return
        self._send_json(self.dc.stats)

    def _serve_collect_gallery(self):
        if self.dc is None:
            self._send_json({"photos": []})
            return
        self._send_json({"photos": self.dc.gallery})

    def _serve_collect_photo(self, filename):
        if self.dc is None:
            self._send_404()
            return
        data = self.dc.serve_photo(filename)
        if data is None:
            self._send_404()
            return
        self.send_response(200)
        self.send_header("Content-Type", "image/jpeg")
        self.send_header("Content-Length", len(data))
        self.send_header("Cache-Control", "no-cache")
        self._set_cors_headers()
        self.end_headers()
        self.wfile.write(data)

    def _handle_collect_start(self):
        if self.dc is None:
            self._send_json({"error": "data collector not available"}, 503)
            return
        try:
            length = int(self.headers.get("Content-Length", 0))
            data = {}
            if length:
                data = json.loads(self.rfile.read(length))
            ok, msg = self.dc.start(
                interval_s=data.get("interval_s"),
                quality=data.get("quality"),
            )
            self._send_json({"ok": ok, "message": msg})
        except Exception as e:
            self._send_json({"error": str(e)}, 500)

    def _handle_collect_stop(self):
        if self.dc is None:
            self._send_json({"error": "data collector not available"}, 503)
            return
        try:
            ok, msg = self.dc.stop()
            self._send_json({"ok": ok, "message": msg})
        except Exception as e:
            self._send_json({"error": str(e)}, 500)

    # ─── AI Settings endpoints ─────────────────────────────────────────────────

    def _serve_ai_settings(self):
        from config import cfg
        data = cfg.as_dict()
        # Mask secrets — send only whether a key is set, not the value
        def _masked(key: str) -> str:
            v = data.get(key, "")
            if not v:
                return ""
            return "***" + v[-4:] if len(v) > 4 else "****"

        self._send_json({
            "ai_provider":   data.get("ai_provider", "openai"),
            "ai_timeout_s":  data.get("ai_timeout_s", 15),
            "openai_model":  data.get("openai_model", "gpt-4o-mini"),
            "openai_key_set": bool(data.get("openai_api_key")),
            "openai_key_hint": _masked("openai_api_key"),
            "gemini_model":  data.get("gemini_model", "gemini-1.5-flash"),
            "gemini_key_set": bool(data.get("gemini_api_key")),
            "gemini_key_hint": _masked("gemini_api_key"),
            "claude_model":  data.get("claude_model", "claude-haiku-4-5-20251001"),
            "claude_key_set": bool(data.get("claude_api_key")),
            "claude_key_hint": _masked("claude_api_key"),
            "prompt_scene":  data.get("prompt_scene", ""),
            "prompt_qris":   data.get("prompt_qris", ""),
        })

    def _handle_ai_settings_save(self):
        try:
            length = int(self.headers.get("Content-Length", 0))
            body   = json.loads(self.rfile.read(length)) if length else {}
            from config import cfg

            # Only accept known AI-settings keys
            allowed = {
                "ai_provider", "ai_timeout_s",
                "openai_api_key", "openai_model",
                "gemini_api_key", "gemini_model",
                "claude_api_key", "claude_model",
                "prompt_scene",   "prompt_qris",
            }
            payload = {k: v for k, v in body.items() if k in allowed}
            # Ignore empty strings for secret keys (UI sends "" when unchanged)
            for key in ("openai_api_key", "gemini_api_key", "claude_api_key"):
                if payload.get(key) == "" or payload.get(key) == "****":
                    payload.pop(key, None)

            cfg.update(payload)
            self.logger.info(
                f"AI settings saved: {[k for k in payload if 'key' not in k]}"
            )
            self._send_json({"ok": True, "applied": list(payload.keys())})
        except Exception as e:
            self._send_json({"error": str(e)}, 500)

    def _handle_ai_settings_test(self):
        try:
            from config import cfg
            from adapters import get_adapter
            adapter = get_adapter(cfg.AI_PROVIDER, cfg)
            result  = adapter.test_connection()
            self._send_json(result)
        except ValueError as e:
            self._send_json({"ok": False, "message": str(e)}, 400)
        except Exception as e:
            self._send_json({"ok": False, "message": str(e)}, 500)

    # ─── Helpers ───────────────────────────────────────────────────────────────

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


# ─── WebServer ─────────────────────────────────────────────────────────────────

class WebServer:
    def __init__(self, host, port, orchestrator, logger, data_collector=None):
        self.host = host
        self.port = port
        self.orch = orchestrator
        self.logger = logger
        self.data_collector = data_collector

    def start(self):
        handler = partial(AuralAIHandler, self.orch, self.logger, self.data_collector)
        server  = HTTPServer((self.host, self.port), handler)
        self.logger.ok(f"Web server listening on {self.host}:{self.port}")
        server.serve_forever()
