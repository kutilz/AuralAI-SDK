"""
Core Orchestrator — State machine & mode switcher.
Mengatur transisi antar mode, AI Focus flag, dan shared state
yang diakses bersama oleh AI loop dan Web Server.
"""

import threading
import time
from collections import deque
from config import AI_FOCUS_DURATION_S


class Orchestrator:
    """
    Shared state antara Thread AI dan Thread Web Server.
    Semua akses ke data bersama harus lewat lock.
    """

    MODES = {"explorer", "context", "qris"}

    def __init__(self, logger):
        self.logger = logger
        self._lock = threading.Lock()

        # ─── Mode ─────────────────────────────────────────────────────
        self._mode = "explorer"

        # ─── AI Focus ─────────────────────────────────────────────────
        self._ai_focus = False
        self._ai_focus_until = 0.0

        # ─── Detection Results ────────────────────────────────────────
        self._detections = []        # list of dicts

        # ─── Snapshot ─────────────────────────────────────────────────
        self._snapshot_bytes = None  # bytes JPEG terbaru

        # ─── Latency ──────────────────────────────────────────────────
        self._latency = {
            "camera_ms": 0,
            "inference_ms": 0,
            "postproc_ms": 0,
            "total_ms": 0,
            "fps": 0.0,
        }

        # ─── Audio Queue ──────────────────────────────────────────────
        self._audio_queue = deque(maxlen=10)

        # ─── Control ──────────────────────────────────────────────────
        self._running = True
        self._pending_command = None

        # ─── AI engine & audio manager refs (set setelah init) ────────
        self.ai_engine = None
        self.audio_manager = None

    # ─── Properties (thread-safe) ─────────────────────────────────────────────

    @property
    def mode(self):
        with self._lock:
            return self._mode

    @mode.setter
    def mode(self, value):
        if value not in self.MODES:
            raise ValueError(f"Unknown mode: {value}")
        with self._lock:
            self._mode = value

    @property
    def ai_focus(self):
        with self._lock:
            if self._ai_focus and time.time() > self._ai_focus_until:
                self._ai_focus = False
            return self._ai_focus

    def activate_ai_focus(self, duration=None):
        d = duration or AI_FOCUS_DURATION_S
        with self._lock:
            self._ai_focus = True
            self._ai_focus_until = time.time() + d
        self.logger.info(f"AI Focus aktif selama {d} detik")

    @property
    def detections(self):
        with self._lock:
            return list(self._detections)

    @detections.setter
    def detections(self, value):
        with self._lock:
            self._detections = value

    @property
    def snapshot(self):
        with self._lock:
            return self._snapshot_bytes

    @snapshot.setter
    def snapshot(self, value):
        with self._lock:
            self._snapshot_bytes = value

    @property
    def latency(self):
        with self._lock:
            return dict(self._latency)

    @latency.setter
    def latency(self, value):
        with self._lock:
            self._latency.update(value)

    def enqueue_audio(self, text):
        with self._lock:
            self._audio_queue.append(text)

    def pop_audio(self):
        with self._lock:
            return self._audio_queue.popleft() if self._audio_queue else None

    def set_pending_command(self, cmd, data=None):
        with self._lock:
            self._pending_command = {"cmd": cmd, "data": data}

    def pop_pending_command(self):
        with self._lock:
            cmd = self._pending_command
            self._pending_command = None
            return cmd

    def get_status(self):
        """Return ringkasan status untuk endpoint /status."""
        with self._lock:
            return {
                "mode": self._mode,
                "ai_focus": self._ai_focus,
                "detections": list(self._detections),
                "latency": dict(self._latency),
                "audio_queue_size": len(self._audio_queue),
            }

    # ─── AI Loop ──────────────────────────────────────────────────────────────

    def run_ai_loop(self):
        """Entry point untuk thread AI — di-override oleh mode yang aktif."""
        from core.ai_engine import AIEngine
        from core.audio_manager import AudioManager

        self.ai_engine = AIEngine(orchestrator=self, logger=self.logger)
        self.audio_manager = AudioManager(orchestrator=self, logger=self.logger)

        self.logger.info("AI Engine & Audio Manager siap")

        while self._running:
            # Handle pending command dari Web UI
            cmd = self.pop_pending_command()
            if cmd:
                self._handle_command(cmd)

            # Skip AI inference jika AI Focus aktif
            if self.ai_focus:
                time.sleep(0.05)
                continue

            mode = self.mode

            if mode == "explorer":
                from modes.explorer_mode import run_explorer_tick
                run_explorer_tick(self)
            elif mode == "context":
                from modes.context_mode import run_context_tick
                run_context_tick(self)
            elif mode == "qris":
                # Mode QRIS hanya aktif saat ada command
                time.sleep(0.1)
            else:
                time.sleep(0.1)

    def _handle_command(self, cmd_obj):
        cmd = cmd_obj.get("cmd")
        data = cmd_obj.get("data", {})

        if cmd == "focus":
            self.activate_ai_focus()
        elif cmd == "set_mode":
            new_mode = data.get("mode", "explorer")
            self.mode = new_mode
            self.enqueue_audio(f"mode {new_mode} aktif")
            self.logger.info(f"Mode diubah ke: {new_mode}")
        elif cmd == "qris":
            if self.ai_engine:
                self.ai_engine.trigger_qris_scan()
        elif cmd == "describe":
            if self.ai_engine:
                self.ai_engine.trigger_scene_description()

    def stop(self):
        self._running = False
