"""
Logger — Logging ke file dan stream ke Web UI.
"""

import os
import time
import threading
from collections import deque
from config import LOG_PATH, LOG_MAX_LINES


class Logger:
    LEVELS = {"info", "ok", "warn", "error"}

    def __init__(self):
        self._lock = threading.Lock()
        self._buffer = deque(maxlen=LOG_MAX_LINES)
        self._log_file = None
        self._init_file()

    def _init_file(self):
        try:
            os.makedirs(LOG_PATH, exist_ok=True)
            log_name = f"aural_{time.strftime('%Y%m%d_%H%M%S')}.log"
            self._log_file = open(os.path.join(LOG_PATH, log_name), "a", encoding="utf-8")
        except Exception:
            self._log_file = None

    def _log(self, level, message):
        ts = time.strftime("%H:%M:%S")
        entry = {
            "time": ts,
            "level": level,
            "message": message,
        }
        with self._lock:
            self._buffer.append(entry)

        line = f"[{ts}] [{level.upper():5s}] {message}"
        print(line)

        if self._log_file:
            try:
                self._log_file.write(line + "\n")
                self._log_file.flush()
            except Exception:
                pass

    def info(self, msg):  self._log("info", msg)
    def ok(self, msg):    self._log("ok", msg)
    def warn(self, msg):  self._log("warn", msg)
    def error(self, msg): self._log("error", msg)

    def get_recent(self, n=50):
        with self._lock:
            entries = list(self._buffer)
        return entries[-n:]

    def __del__(self):
        if self._log_file:
            try:
                self._log_file.close()
            except Exception:
                pass


def position_from_bbox(x, y, w, h, frame_w, frame_h):
    """
    Tentukan posisi objek dalam grid 3×3 berdasarkan center bounding box.

    Returns: string posisi ('kiri', 'kanan', 'tengah', 'kiri-atas', dst.)
    """
    cx = x + w / 2
    cy = y + h / 2

    col = int(cx / frame_w * 3)   # 0=kiri, 1=tengah, 2=kanan
    row = int(cy / frame_h * 3)   # 0=atas, 1=tengah, 2=bawah

    col = min(col, 2)
    row = min(row, 2)

    col_names = ["kiri", "tengah", "kanan"]
    row_names = ["atas", "tengah", "bawah"]

    col_n = col_names[col]
    row_n = row_names[row]

    if row_n == "tengah":
        return col_n
    elif col_n == "tengah":
        return row_n
    else:
        return f"{col_n}-{row_n}"
