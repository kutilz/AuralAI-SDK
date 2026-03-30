"""
Audio Manager — Mengelola queue audio dan playback di MaixCAM.
Fallback ke Web UI jika file WAV tidak tersedia.
"""

import os
import time
import threading
from collections import defaultdict
from config import AUDIO_DIR, AUDIO_COOLDOWN_S


class AudioManager:
    def __init__(self, orchestrator, logger):
        self.orch = orchestrator
        self.logger = logger
        self._lock = threading.Lock()
        self._last_played = defaultdict(float)  # label → last play time
        self._playing = False
        self._thread = threading.Thread(target=self._loop, daemon=True, name="AudioMgr")
        self._thread.start()

    def _loop(self):
        """Background loop yang memproses audio queue dari orchestrator."""
        while True:
            text = self.orch.pop_audio()
            if text:
                self._play(text)
            else:
                time.sleep(0.05)

    def queue(self, text, label=None):
        """
        Tambah audio ke queue.
        label: digunakan untuk cooldown (agar label yang sama tidak berulang terlalu cepat)
        """
        key = label or text

        with self._lock:
            last = self._last_played[key]

        if time.time() - last < AUDIO_COOLDOWN_S:
            return  # Masih dalam cooldown

        with self._lock:
            self._last_played[key] = time.time()

        self.orch.enqueue_audio(text)

    def _play(self, text):
        """Coba mainkan WAV, fallback ke log/Web UI jika tidak ada."""
        filename = self._text_to_filename(text)
        wav_path = os.path.join(AUDIO_DIR, filename)

        if os.path.exists(wav_path):
            self._play_wav(wav_path)
        else:
            # Fallback: kirim teks ke Web UI sebagai notifikasi audio
            self.logger.info(f"[Audio fallback] {text}")
            # Web UI akan membacanya via Web Speech API

    def _play_wav(self, path):
        try:
            from maix import audio
            player = audio.Player()
            player.play(path)
            self.logger.ok(f"Audio: {os.path.basename(path)}")
        except ImportError:
            self.logger.warn(f"MaixPy audio tidak tersedia — skip: {path}")
        except Exception as e:
            self.logger.error(f"Audio play error: {e}")

    def _text_to_filename(self, text):
        """Konversi teks ke nama file WAV."""
        clean = text.lower().strip()
        clean = clean.replace(" ", "_").replace("-", "_")
        clean = "".join(c for c in clean if c.isalnum() or c == "_")
        return f"{clean}.wav"

    def queue_object(self, label, position):
        """Helper khusus untuk object detection — pakai naming convention yang standar."""
        text = f"{label} {position}"
        filename_label = label.replace(" ", "_")
        filename_pos = position.replace("-", "_").replace(" ", "_")
        filename = f"obj_{filename_label}_{filename_pos}.wav"

        wav_path = os.path.join(AUDIO_DIR, filename)
        key = f"obj_{label}_{position}"

        with self._lock:
            last = self._last_played[key]

        if time.time() - last < AUDIO_COOLDOWN_S:
            return

        with self._lock:
            self._last_played[key] = time.time()

        if os.path.exists(wav_path):
            self._play_wav(wav_path)
        else:
            self.orch.enqueue_audio(text)
            self.logger.info(f"[Audio sim] {text}")

    def queue_system(self, event):
        """Putar system audio: 'mode_explorer_aktif', 'baterai_lemah', dll."""
        wav_path = os.path.join(AUDIO_DIR, f"system_{event}.wav")
        key = f"system_{event}"

        with self._lock:
            last = self._last_played[key]

        if time.time() - last < AUDIO_COOLDOWN_S:
            return

        with self._lock:
            self._last_played[key] = time.time()

        if os.path.exists(wav_path):
            self._play_wav(wav_path)
        else:
            readable = event.replace("_", " ")
            self.orch.enqueue_audio(readable)
