"""
Orchestrator — Event-driven state machine & shared state hub.

Mode transitions
────────────────
  switch_mode(new_mode)   Thread-safe; releases resources from the old mode,
                          loads resources for the new one, plays a confirmation
                          audio cue. Can be called from any thread.

Hardware button
───────────────
  If cfg.BUTTON_PIN_MODE >= 0, a dedicated thread monitors that GPIO pin and
  cycles through modes on each falling edge (press). Configure the pin number
  in /root/config.json ("button_pin_mode": <N>).

Watchdog
────────
  The Orchestrator exposes self.watchdog so the AI Engine can send heartbeats.
  Set by main.py after creation via orch.watchdog = wd.

Thermal throttling
──────────────────
  HealthMonitor calls _on_thermal_throttle / _on_thermal_recover which adjust
  the effective camera FPS by writing to cfg at runtime.
"""

import threading
import time
from typing import Optional

from config import cfg


class Orchestrator:

    MODES = ("explorer", "context", "qris")
    # Button press cycles through modes in this order
    _MODE_CYCLE = {"explorer": "context", "context": "qris", "qris": "explorer"}

    # Modes that keep YOLO loaded
    _YOLO_MODES = {"explorer"}

    def __init__(self, logger):
        self.logger = logger

        # ── Shared state ──────────────────────────────────────────────────────
        self._lock = threading.Lock()

        self._mode      = "explorer"
        self._ai_focus  = False
        self._ai_focus_until = 0.0

        self._detections  = []
        self._snapshot_bytes: Optional[bytes] = None
        self._latency = {
            "camera_ms": 0, "inference_ms": 0,
            "postproc_ms": 0, "total_ms": 0, "fps": 0.0,
        }

        self._pending_command = None
        self._running         = True

        # ── Module references (set after init) ────────────────────────────────
        self.ai_engine:    object = None
        self.audio_manager: object = None
        self.watchdog:      object = None   # set by main.py

        # ── Mode-change event (wakes AI loop when mode switches) ──────────────
        self._mode_event = threading.Event()

        # ── Hardware button ────────────────────────────────────────────────────
        pin = cfg.BUTTON_PIN_MODE
        if pin >= 0:
            self._start_button_listener(pin)

    # ─── Thread-safe properties ───────────────────────────────────────────────

    @property
    def mode(self) -> str:
        with self._lock:
            return self._mode

    @property
    def ai_focus(self) -> bool:
        with self._lock:
            if self._ai_focus and time.time() > self._ai_focus_until:
                self._ai_focus = False
            return self._ai_focus

    def activate_ai_focus(self, duration: Optional[float] = None):
        d = duration or cfg.AI_FOCUS_DURATION_S
        with self._lock:
            self._ai_focus       = True
            self._ai_focus_until = time.time() + d
        self.logger.info(f"AI Focus active for {d}s", module="Orchestrator")

    @property
    def detections(self) -> list:
        with self._lock:
            return list(self._detections)

    @detections.setter
    def detections(self, value: list):
        with self._lock:
            self._detections = value

    @property
    def snapshot(self) -> Optional[bytes]:
        with self._lock:
            return self._snapshot_bytes

    @snapshot.setter
    def snapshot(self, value: bytes):
        with self._lock:
            self._snapshot_bytes = value

    @property
    def latency(self) -> dict:
        with self._lock:
            return dict(self._latency)

    @latency.setter
    def latency(self, value: dict):
        with self._lock:
            self._latency.update(value)

    # ─── Audio (delegates to AudioManager) ───────────────────────────────────

    def enqueue_audio(self, text: str):
        """Low-priority audio — wraps audio_manager.queue_info for compat."""
        if self.audio_manager:
            self.audio_manager.queue_info(text)

    def pop_audio(self):
        """Legacy stub for web_server.py — audio now plays on-device directly."""
        return None

    # ─── Command queue (from Web UI) ─────────────────────────────────────────

    def set_pending_command(self, cmd: str, data: dict = None):
        with self._lock:
            self._pending_command = {"cmd": cmd, "data": data or {}}

    def pop_pending_command(self) -> Optional[dict]:
        with self._lock:
            cmd = self._pending_command
            self._pending_command = None
            return cmd

    # ─── Status snapshot ──────────────────────────────────────────────────────

    def get_status(self) -> dict:
        audio_text = ""
        if self.audio_manager:
            try:
                audio_text = self.audio_manager.current_text
            except Exception:
                pass
        with self._lock:
            return {
                "mode":        self._mode,
                "ai_focus":    self._ai_focus,
                "detections":  list(self._detections),
                "latency":     dict(self._latency),
                "audio_text":  audio_text,
            }

    # ─── Mode switching ───────────────────────────────────────────────────────

    def switch_mode(self, new_mode: str):
        """
        Thread-safe mode switch.
        1. Validates the new mode.
        2. Releases resources from the old mode.
        3. Updates internal state.
        4. Loads resources for the new mode.
        5. Plays a confirmation cue.
        """
        if new_mode not in self.MODES:
            self.logger.warn(f"Unknown mode: {new_mode}", module="Orchestrator")
            return

        with self._lock:
            if self._mode == new_mode:
                return
            old_mode   = self._mode
            self._mode = new_mode

        self.logger.info(
            f"Mode: {old_mode} → {new_mode}",
            module="Orchestrator",
            transition=f"{old_mode}→{new_mode}",
        )

        # Release NPU model when leaving explorer mode
        if old_mode in self._YOLO_MODES and new_mode not in self._YOLO_MODES:
            if self.ai_engine:
                self.ai_engine.release_model()

        # Reload NPU model when returning to explorer mode
        if new_mode in self._YOLO_MODES and old_mode not in self._YOLO_MODES:
            if self.ai_engine:
                self.ai_engine.reload_model()

        # Wake up the AI loop so it picks up the new mode immediately
        self._mode_event.set()

        if self.audio_manager:
            self.audio_manager.queue_system(f"mode_{new_mode}")

    # ─── Hardware button listener ─────────────────────────────────────────────

    def _start_button_listener(self, pin: int):
        def _loop():
            try:
                from maix import gpio
                btn        = gpio.GPIO(gpio.PIN(f"GPIO{pin}"), gpio.Mode.IN)
                last_state = btn.value()
                self.logger.info(
                    f"Button listener active on GPIO{pin}", module="Orchestrator"
                )
                while self._running:
                    state = btn.value()
                    if state == 0 and last_state == 1:   # falling edge = press
                        next_mode = self._MODE_CYCLE[self.mode]
                        self.switch_mode(next_mode)
                        time.sleep(0.3)                  # debounce
                    last_state = state
                    time.sleep(0.02)
            except Exception as e:
                self.logger.warn(
                    f"GPIO button unavailable (pin {pin}): {e}",
                    module="Orchestrator",
                )

        threading.Thread(target=_loop, daemon=True, name="BtnListener").start()

    # ─── Thermal throttling callbacks ─────────────────────────────────────────

    def _on_thermal_throttle(self, temp_c: float):
        self.logger.warn(
            f"Thermal throttle engaged at {temp_c:.1f}°C — reducing FPS",
            module="Orchestrator",
        )
        cfg.set("camera_fps", cfg.THERMAL_THROTTLE_FPS)
        if self.audio_manager:
            self.audio_manager.queue_system("suhu_tinggi")

    def _on_thermal_recover(self, temp_c: float):
        self.logger.info(
            f"Thermal recover at {temp_c:.1f}°C — restoring FPS",
            module="Orchestrator",
        )
        cfg.set("camera_fps", cfg.get("camera_fps_normal", 30))

    # ─── Main AI loop ─────────────────────────────────────────────────────────

    def run_ai_loop(self):
        """Entry point for the AI thread."""
        from core.ai_engine    import AIEngine
        from core.audio_manager import AudioManager

        self.ai_engine     = AIEngine(orchestrator=self, logger=self.logger)
        self.audio_manager = AudioManager(orchestrator=self, logger=self.logger)

        # Register AI engine with watchdog if available
        if self.watchdog:
            self.watchdog.register(
                "ai_engine",
                timeout_s=cfg.WATCHDOG_TIMEOUT_S,
                restart_fn=self.ai_engine.reload,
            )

        self.logger.ok("AI Engine + Audio Manager ready", module="Orchestrator")

        while self._running:
            # Clear the mode-change event at the top of each cycle
            self._mode_event.clear()

            # Process one pending command from Web UI
            cmd = self.pop_pending_command()
            if cmd:
                self._handle_command(cmd)

            # While AI Focus is active, skip inference and wait
            if self.ai_focus:
                self._mode_event.wait(timeout=0.05)
                continue

            mode = self.mode

            if mode == "explorer":
                from modes.explorer_mode import run_explorer_tick
                run_explorer_tick(self)
            elif mode == "context":
                from modes.context_mode import run_context_tick
                run_context_tick(self)
            elif mode == "qris":
                # QRIS only activates on-demand via command; idle here
                self._mode_event.wait(timeout=0.1)
            else:
                self._mode_event.wait(timeout=0.1)

    def _handle_command(self, cmd_obj: dict):
        cmd  = cmd_obj.get("cmd")
        data = cmd_obj.get("data", {})

        if cmd == "focus":
            self.activate_ai_focus()

        elif cmd == "set_mode":
            self.switch_mode(data.get("mode", "explorer"))

        elif cmd == "qris":
            if self.ai_engine:
                self.ai_engine.trigger_qris_scan()

        elif cmd == "describe":
            if self.ai_engine:
                self.ai_engine.trigger_scene_description()

        elif cmd == "update_config":
            cfg.update(data)
            self.logger.info(f"Config updated: {list(data.keys())}",
                             module="Orchestrator")

    def stop(self):
        self._running = False
        self._mode_event.set()   # unblock any waiting loop
        if self.audio_manager:
            self.audio_manager.stop()
