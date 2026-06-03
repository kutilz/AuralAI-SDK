"""
Spoken-URL onboarding for the screen-less assistive device.

The MaixCAM's screen is removed — the user is blind and the only outputs are the
speaker (TTS) and the single button. After WiFi is up and the web server is
listening, the device speaks how to reach its dashboard. The button repeats the
announcement (short press) or acknowledges it (long press, which silences further
nagging). All announcements are gated so they only run during first-time setup;
a returning, already-provisioned device just speaks a short "ready" cue on boot.

Reuses the existing TTS pipeline (utils/tts → AudioManager) — no new audio path.
"""

import socket
import threading
import time

from config import cfg
from core.audio_manager import NORMAL


class OnboardingAnnouncer:
    def __init__(self, orchestrator, logger):
        self.orch = orchestrator
        self.logger = logger

    # ─── gating ───────────────────────────────────────────────────────────────

    def _should_nag(self) -> bool:
        return (
            bool(cfg.get("url_announce_enabled", True))
            and not bool(cfg.get("setup_completed", False))
            and not bool(cfg.get("url_ack", False))
        )

    # ─── announce / acknowledge ───────────────────────────────────────────────

    def announce(self, force: bool = False):
        """Speak the onboarding phrase. force=True bypasses the gate (button repeat)."""
        if not force and not self._should_nag():
            return
        am = getattr(self.orch, "audio_manager", None)
        if am is None:
            return
        try:
            from utils.identity import onboarding_phrase
            text = onboarding_phrase(port=int(cfg.get("web_port", 8080)))
        except Exception as e:
            self.logger.warn(f"onboarding phrase failed: {e}", module="Onboard")
            return
        am.queue(text, priority=NORMAL, label="onboard_url", cooldown=3.0)

    def acknowledge(self):
        """User long-pressed 'understood' — stop re-announcing the URL."""
        try:
            cfg.update({"url_ack": True})
        except Exception:
            pass
        am = getattr(self.orch, "audio_manager", None)
        if am is not None:
            am.queue("Baik, sudah paham.", priority=NORMAL,
                     label="onboard_ack", cooldown=0)
        self.logger.info("Onboarding URL acknowledged by user", module="Onboard")

    # ─── boot wait loop ───────────────────────────────────────────────────────

    def wait_and_announce_on_boot(self):
        """Daemon: wait for WiFi+web (+audio), then announce; re-nag a few minutes."""
        deadline = time.monotonic() + 180.0     # allow WiFi up to 3 min to connect
        ready = False
        while self.orch._running and time.monotonic() < deadline:
            if self._web_ready() and self._has_ip():
                ready = True
                break
            time.sleep(1.0)
        if not ready:
            self.logger.warn(
                "Boot announce skipped — WiFi/web not ready in time", module="Onboard")
            return

        # The AudioManager is built by the AI thread; wait briefly for it.
        am = getattr(self.orch, "audio_manager", None)
        waited = 0.0
        while am is None and waited < 15.0 and self.orch._running:
            time.sleep(0.5)
            waited += 0.5
            am = getattr(self.orch, "audio_manager", None)

        if self._should_nag():
            try:
                self._prewarm()      # synth once now that internet is up
            except Exception:
                pass
            self.announce()
            nag_until = time.monotonic() + 300.0   # re-nag for ~5 min
            while self.orch._running and time.monotonic() < nag_until:
                time.sleep(60.0)
                if self._should_nag():
                    self.announce()
                else:
                    break
        elif am is not None:
            am.queue("AuralAI siap digunakan.", priority=NORMAL,
                     label="boot_ready", cooldown=0)

    # ─── readiness helpers ────────────────────────────────────────────────────

    def _web_ready(self) -> bool:
        try:
            with socket.create_connection(
                ("127.0.0.1", int(cfg.get("web_port", 8080))), 0.5):
                return True
        except OSError:
            return False

    def _has_ip(self) -> bool:
        try:
            from utils.identity import current_ip
            return bool(current_ip())
        except Exception:
            return False

    def _prewarm(self):
        """Pre-synthesize the phrase so the first announcement isn't delayed."""
        from utils.identity import onboarding_phrase
        from utils.tts import get_or_synthesize
        text = onboarding_phrase(port=int(cfg.get("web_port", 8080)))
        get_or_synthesize(
            text, cache_dir=cfg.get("tts_cache_dir", "/root/audio/tts_cache"))
