"""
Audio Manager — Mengelola queue audio dan playback di MaixCAM.
Audio source (WAV/MP3/dll) dikonversi ke PCM s16le 48kHz mono via FFmpeg
sebelum diputar. File PCM di-cache di sebelah source agar konversi hanya
dilakukan sekali. Fallback ke Web UI jika file tidak tersedia.
"""

import os
import time
import threading
from collections import defaultdict
from config import AUDIO_DIR, AUDIO_COOLDOWN_S

# PCM constants (sesuai standar MaixCAM audio.Player default)
_PCM_RATE    = 48000  # Hz
_PCM_BYTES_S = _PCM_RATE * 2  # s16le mono = 2 bytes/sample


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
            self._play_file(wav_path)
        else:
            # Fallback: kirim teks ke Web UI sebagai notifikasi audio
            self.logger.info(f"[Audio fallback] {text}")
            # Web UI akan membacanya via Web Speech API

    def _ensure_pcm(self, source_path) -> str | None:
        """
        Konversi file audio apapun ke PCM s16le 48kHz mono via FFmpeg.
        Hasil di-cache sebagai <base>.pcm di sebelah file sumber.
        Returns path file PCM, atau None jika gagal.
        """
        base    = os.path.splitext(source_path)[0]
        pcm     = f"{base}.pcm"

        if os.path.exists(pcm):
            return pcm

        # Deteksi format untuk logging
        try:
            with open(source_path, 'rb') as f:
                hdr = f.read(4)
            fmt = "WAV" if hdr.startswith(b'RIFF') else \
                  "MP3" if (hdr.startswith(b'ID3') or hdr[:2] in (b'\xff\xfb', b'\xff\xf3')) else \
                  "?"
            self.logger.info(f"[Audio] Konversi {fmt} → PCM: {os.path.basename(source_path)}")
        except Exception:
            pass

        ret = os.system(
            f"ffmpeg -v warning -y -i '{source_path}' "
            f"-f s16le -acodec pcm_s16le -ar {_PCM_RATE} -ac 1 '{pcm}'"
        )
        if ret != 0 or not os.path.exists(pcm):
            self.logger.error(f"[Audio] FFmpeg gagal konversi: {source_path}")
            return None
        return pcm

    def _play_file(self, path):
        """Konversi ke PCM lalu play via maix.audio.Player."""
        try:
            from maix import audio as maix_audio
        except ImportError:
            self.logger.warn("[Audio] MaixPy tidak tersedia — skip playback")
            return

        pcm_path = self._ensure_pcm(path)
        if not pcm_path:
            return

        try:
            with open(pcm_path, 'rb') as f:
                pcm_data = f.read()

            player = maix_audio.Player()
            player.volume(80)
            player.play(bytes(pcm_data))

            # Tunggu selesai: estimasi durasi dari ukuran PCM + buffer kecil
            duration_s = len(pcm_data) / _PCM_BYTES_S
            time.sleep(duration_s + 0.15)

            self.logger.ok(f"[Audio] {os.path.basename(path)}")
        except Exception as e:
            self.logger.error(f"[Audio] Play error: {e}")

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
            self._play_file(wav_path)
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
            self._play_file(wav_path)
        else:
            readable = event.replace("_", " ")
            self.orch.enqueue_audio(readable)
