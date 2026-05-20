"""
Audio Manager — Non-blocking priority queue playback.

Priority levels (lower number = higher priority):
  CRITICAL (0) — close-range obstacle / emergency
  HIGH     (1) — important detection
  NORMAL   (2) — regular detection / system event
  LOW      (3) — informational / scene description

A newly queued task at a higher priority than what is currently
playing will interrupt playback immediately.
"""

import os
import time
import queue
import threading
from collections import defaultdict
from typing import Optional

CRITICAL = 0
HIGH     = 1
NORMAL   = 2
LOW      = 3

_PCM_RATE    = 48000
_PCM_BYTES_S = _PCM_RATE * 2   # s16le mono = 2 bytes/sample

# Monotonically increasing counter for stable ordering within same priority
_SEQ      = 0
_SEQ_LOCK = threading.Lock()


def _next_seq() -> int:
    global _SEQ
    with _SEQ_LOCK:
        _SEQ += 1
        return _SEQ


class _Task:
    __slots__ = ("text", "wav_path", "priority", "label", "seq")

    def __init__(self, text: str, wav_path: Optional[str],
                 priority: int, label: str):
        self.text     = text
        self.wav_path = wav_path
        self.priority = priority
        self.label    = label
        self.seq      = _next_seq()

    def __lt__(self, other: "_Task") -> bool:
        if self.priority != other.priority:
            return self.priority < other.priority
        return self.seq < other.seq


class AudioManager:

    def __init__(self, orchestrator, logger):
        self.orch   = orchestrator
        self.logger = logger

        # Resolved at construction so they can't change mid-run unexpectedly
        try:
            from config import cfg as _cfg
            self._audio_dir  = _cfg.AUDIO_DIR
            self._cooldown_s = _cfg.AUDIO_COOLDOWN_S
        except Exception:
            self._audio_dir  = "/root/audio"
            self._cooldown_s = 2.0

        self._pq: queue.PriorityQueue = queue.PriorityQueue()

        # label → monotonic timestamp of last play
        self._cooldown_map: dict = defaultdict(float)
        self._cd_lock = threading.Lock()

        # Tracks priority of whatever is playing right now
        self._current_priority = LOW
        # Text currently being played (exposed to status endpoint)
        self._current_text: str = ""
        self._text_lock = threading.Lock()
        # Set to interrupt ongoing playback sleep loop
        self._interrupt = threading.Event()
        self._stop      = threading.Event()

        self._thread = threading.Thread(
            target=self._loop, daemon=True, name="AudioMgr"
        )
        self._thread.start()

    # ─── Public API ───────────────────────────────────────────────────────────

    def queue(self, text: str, priority: int = NORMAL, label: str = "",
              cooldown: Optional[float] = None):
        """
        Add text to the playback queue.
        If priority is higher than current playback, interrupt immediately.
        """
        cd = cooldown if cooldown is not None else self._cooldown_s

        if label and cd > 0:
            with self._cd_lock:
                if time.monotonic() - self._cooldown_map[label] < cd:
                    return

        wav  = self._find_wav(text)
        task = _Task(text, wav, priority, label)
        self._pq.put((priority, task.seq, task))

        if priority < self._current_priority:
            self._interrupt.set()

    def queue_object(self, label: str, position: str, is_danger: bool = False):
        """Helper for detected objects. Danger → CRITICAL, otherwise HIGH."""
        priority = CRITICAL if is_danger else HIGH
        self.queue(
            text=f"{label} {position}",
            priority=priority,
            label=f"obj_{label}_{position}",
        )

    def queue_system(self, event: str):
        """System events (mode switches, low battery, …)."""
        self.queue(event, priority=NORMAL, label=f"sys_{event}")

    def queue_info(self, text: str):
        """Low-priority informational audio (scene description, etc.)."""
        self.queue(text, priority=LOW)

    def clear(self):
        """Discard all pending tasks and stop current playback."""
        while not self._pq.empty():
            try:
                self._pq.get_nowait()
            except queue.Empty:
                break
        self._interrupt.set()

    def stop(self):
        """Shut down the manager thread."""
        self._stop.set()
        self._interrupt.set()

    # ─── Internals ────────────────────────────────────────────────────────────

    def _find_wav(self, text: str) -> Optional[str]:
        """Locate pre-generated WAV for this text, or return None."""
        safe = text.lower().strip()
        safe = safe.replace(" ", "_").replace("-", "_").replace(",", "")
        safe = "".join(c for c in safe if c.isalnum() or c == "_")
        for candidate in (
            os.path.join(self._audio_dir, f"{safe}.wav"),
            os.path.join(self._audio_dir, f"obj_{safe}.wav"),
            os.path.join(self._audio_dir, f"system_{safe}.wav"),
        ):
            if os.path.exists(candidate):
                return candidate
        return None

    def _ensure_pcm(self, wav_path: str) -> Optional[str]:
        """Convert WAV → PCM s16le 48 kHz mono; result cached next to source."""
        pcm = os.path.splitext(wav_path)[0] + ".pcm"
        if os.path.exists(pcm):
            return pcm
        ret = os.system(
            f"ffmpeg -v warning -y -i '{wav_path}' "
            f"-f s16le -acodec pcm_s16le -ar {_PCM_RATE} -ac 1 '{pcm}'"
        )
        return pcm if ret == 0 and os.path.exists(pcm) else None

    @property
    def current_text(self) -> str:
        with self._text_lock:
            return self._current_text

    def _play_task(self, task: _Task):
        """Execute playback for one task; blocks until done or interrupted."""
        if task.label:
            with self._cd_lock:
                self._cooldown_map[task.label] = time.monotonic()

        self._current_priority = task.priority
        with self._text_lock:
            self._current_text = task.text
        self._interrupt.clear()

        played = False
        if task.wav_path:
            pcm = self._ensure_pcm(task.wav_path)
            if pcm:
                played = self._play_pcm(pcm)

        if not played:
            self.logger.info(f"[Audio fallback] {task.text}", module="AudioMgr")

        self._current_priority = LOW
        with self._text_lock:
            self._current_text = ""

    def _play_pcm(self, pcm_path: str) -> bool:
        """
        Play PCM via maix.audio.Player with interrupt support.

        player.stop() is optional — some MaixPy builds lack it.
        When stop() raises AttributeError we fall back to the deadline
        timer: the current audio chunk finishes but we return immediately
        so the higher-priority task starts as soon as possible.
        """
        try:
            from maix import audio as maix_audio
        except ImportError:
            return False

        try:
            with open(pcm_path, "rb") as f:
                pcm_data = f.read()

            player = maix_audio.Player()
            try:
                from config import cfg as _cfg
                player.volume(_cfg.AUDIO_VOLUME)
            except Exception:
                player.volume(80)
            player.play(bytes(pcm_data))   # non-blocking start

            duration_s = len(pcm_data) / _PCM_BYTES_S + 0.15
            deadline   = time.monotonic() + duration_s

            while time.monotonic() < deadline:
                if self._interrupt.is_set() or self._stop.is_set():
                    try:
                        player.stop()
                    except AttributeError:
                        # player.stop() not available — can't hard-stop;
                        # return True immediately so the higher-priority task
                        # starts without waiting for the full deadline.
                        pass
                    except Exception:
                        pass
                    return True
                time.sleep(0.02)

            return True

        except Exception as e:
            self.logger.exception(f"Play error: {e}", module="AudioMgr", exc=e)
            return False

    def _loop(self):
        while not self._stop.is_set():
            try:
                _, _, task = self._pq.get(timeout=0.1)
                self._play_task(task)
            except queue.Empty:
                pass
            except Exception as e:
                self.logger.exception(f"Loop error: {e}", module="AudioMgr", exc=e)
