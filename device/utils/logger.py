"""
Logger — Structured JSON logging to file + console.
Web UI stream via get_recent().
"""

import os
import json
import time
import threading
from collections import deque


class Logger:
    LEVELS = {"debug": 0, "info": 1, "ok": 2, "warn": 3, "error": 4}
    _TAGS  = {"debug": "DBG", "info": "INF", "ok": "OK ", "warn": "WRN", "error": "ERR"}

    def __init__(self, log_path: str = "/root/logs",
                 max_lines: int = 500, min_level: str = "info"):
        self._lock = threading.Lock()
        self._buffer: deque = deque(maxlen=max_lines)
        self._log_file = None
        self._min_level = self.LEVELS.get(min_level, 1)
        self._init_file(log_path)

    def _init_file(self, log_path: str):
        try:
            os.makedirs(log_path, exist_ok=True)
            name = f"aural_{time.strftime('%Y%m%d_%H%M%S')}.log"
            self._log_file = open(os.path.join(log_path, name), "a", encoding="utf-8")
        except Exception:
            self._log_file = None

    def _log(self, level: str, msg: str, module: str = "", **extra):
        if self.LEVELS.get(level, 0) < self._min_level:
            return

        entry = {
            "ts":     time.strftime("%Y-%m-%dT%H:%M:%S"),
            "level":  level,
            "module": module,
            "msg":    msg,
            **extra,
        }
        line = json.dumps(entry, ensure_ascii=False)

        with self._lock:
            self._buffer.append(entry)
            if self._log_file:
                try:
                    self._log_file.write(line + "\n")
                    self._log_file.flush()
                except Exception:
                    pass

        tag = self._TAGS.get(level, "---")
        mod = f"[{module}] " if module else ""
        print(f"[{entry['ts']}] {tag} {mod}{msg}")

    def debug(self, msg: str, module: str = "", **kw): self._log("debug", msg, module, **kw)
    def info(self, msg: str, module: str = "", **kw):  self._log("info",  msg, module, **kw)
    def ok(self, msg: str, module: str = "", **kw):    self._log("ok",    msg, module, **kw)
    def warn(self, msg: str, module: str = "", **kw):  self._log("warn",  msg, module, **kw)
    def error(self, msg: str, module: str = "", **kw): self._log("error", msg, module, **kw)

    def get_recent(self, n: int = 50) -> list:
        with self._lock:
            return list(self._buffer)[-n:]

    def __del__(self):
        if self._log_file:
            try:
                self._log_file.close()
            except Exception:
                pass


# ─── Utility ──────────────────────────────────────────────────────────────────

def position_from_bbox(x, y, w, h, frame_w, frame_h) -> str:
    """Map bounding box center to 3×3 grid position string."""
    cx = x + w / 2
    cy = y + h / 2
    col = min(int(cx / frame_w * 3), 2)
    row = min(int(cy / frame_h * 3), 2)
    col_n = ["kiri",  "tengah", "kanan"][col]
    row_n = ["atas",  "tengah", "bawah"][row]
    if row_n == "tengah":
        return col_n
    if col_n == "tengah":
        return row_n
    return f"{col_n}-{row_n}"
