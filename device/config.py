"""
AuralAI SDK — Dynamic configuration
Loaded from /root/config.json at startup; updatable at runtime via companion API.
"""

import os
import json
import threading
from pathlib import Path

_CONFIG_PATH = Path("/root/config.json")

_DEFAULTS: dict = {
    "model_path":               "/root/models/yolo11n.mud",
    "conf_threshold":           0.5,
    "iou_threshold":            0.45,
    "input_width":              320,
    "input_height":             224,
    "camera_fps":               30,
    "snapshot_interval_ms":     500,
    "web_host":                 "0.0.0.0",
    "web_port":                 8080,
    "ai_focus_duration_s":      5,
    "audio_dir":                "/root/audio",
    "audio_cooldown_s":         2.0,
    "danger_area_threshold":    0.15,
    # ── AI provider ───────────────────────────────────────────────────────────
    # active provider: "openai" | "gemini" | "claude"
    "ai_provider":              "openai",
    "ai_timeout_s":             15,
    # OpenAI
    "openai_api_key":           "",
    "openai_model":             "gpt-4o-mini",
    "openai_timeout_s":         10,   # kept for backward-compat; ai_timeout_s is used
    # Gemini
    "gemini_api_key":           "",
    "gemini_model":             "gemini-1.5-flash",
    # Claude (Anthropic)
    "claude_api_key":           "",
    "claude_model":             "claude-haiku-4-5-20251001",
    # Prompts (runtime-editable)
    "prompt_scene": (
        "Deskripsikan scene ini secara singkat dalam Bahasa Indonesia, "
        "fokus pada objek yang relevan untuk pengguna tunanetra. "
        "Maksimal 2 kalimat."
    ),
    "prompt_qris": (
        "Baca kode QRIS ini. Sebutkan: nama merchant dan nominal jika ada. "
        "Format: MERCHANT: [nama], NOMINAL: [angka]. "
        "Jika bukan QRIS, jawab: BUKAN QRIS."
    ),
    "log_path":                 "/root/logs",
    "log_max_lines":            500,
    "thermal_throttle_temp_c":  80.0,
    "thermal_throttle_fps":     10,
    "watchdog_timeout_s":       5.0,
    # GPIO pin number for hardware mode-cycle button; -1 = disabled
    "button_pin_mode":          -1,
}


class Config:
    """
    Thread-safe configuration backed by /root/config.json.
    Call cfg.update(dict) to change values at runtime — persisted to disk.
    """

    def __init__(self):
        self._lock = threading.RLock()
        self._data: dict = dict(_DEFAULTS)
        self._load()

    # ─── Persistence ──────────────────────────────────────────────────────────

    def _load(self):
        try:
            with open(_CONFIG_PATH) as f:
                loaded = json.load(f)
            with self._lock:
                self._data.update(loaded)
        except FileNotFoundError:
            self._write_defaults()
        except Exception:
            pass

    def _write_defaults(self):
        try:
            _CONFIG_PATH.parent.mkdir(parents=True, exist_ok=True)
            with open(_CONFIG_PATH, "w") as f:
                json.dump(_DEFAULTS, f, indent=2)
        except Exception:
            pass

    def save(self):
        """Persist current config to disk."""
        with self._lock:
            data = dict(self._data)
        try:
            with open(_CONFIG_PATH, "w") as f:
                json.dump(data, f, indent=2)
        except Exception:
            pass

    # ─── Read / Write ─────────────────────────────────────────────────────────

    def get(self, key: str, default=None):
        with self._lock:
            return self._data.get(key, default)

    def set(self, key: str, value):
        with self._lock:
            self._data[key] = value

    def update(self, mapping: dict):
        """Merge mapping into config and save to disk."""
        with self._lock:
            self._data.update(mapping)
        self.save()

    def as_dict(self) -> dict:
        with self._lock:
            return dict(self._data)

    # ─── Typed properties ─────────────────────────────────────────────────────

    @property
    def MODEL_PATH(self) -> str:
        return self.get("model_path")

    @property
    def CONF_THRESHOLD(self) -> float:
        return self.get("conf_threshold")

    @property
    def IOU_THRESHOLD(self) -> float:
        return self.get("iou_threshold")

    @property
    def INPUT_WIDTH(self) -> int:
        return self.get("input_width")

    @property
    def INPUT_HEIGHT(self) -> int:
        return self.get("input_height")

    @property
    def CAMERA_FPS(self) -> int:
        return self.get("camera_fps")

    @property
    def SNAPSHOT_INTERVAL_MS(self) -> int:
        return self.get("snapshot_interval_ms")

    @property
    def WEB_HOST(self) -> str:
        return self.get("web_host")

    @property
    def WEB_PORT(self) -> int:
        return self.get("web_port")

    @property
    def AI_FOCUS_DURATION_S(self) -> int:
        return self.get("ai_focus_duration_s")

    @property
    def AUDIO_DIR(self) -> str:
        return self.get("audio_dir")

    @property
    def AUDIO_COOLDOWN_S(self) -> float:
        return self.get("audio_cooldown_s")

    @property
    def DANGER_AREA_THRESHOLD(self) -> float:
        return self.get("danger_area_threshold")

    @property
    def AI_PROVIDER(self) -> str:
        return self.get("ai_provider", "openai")

    @property
    def AI_TIMEOUT_S(self) -> int:
        return self.get("ai_timeout_s", 15)

    @property
    def OPENAI_API_KEY(self) -> str:
        return os.environ.get("OPENAI_API_KEY") or self.get("openai_api_key", "")

    @property
    def OPENAI_MODEL(self) -> str:
        return self.get("openai_model")

    @property
    def OPENAI_TIMEOUT_S(self) -> int:
        return self.get("openai_timeout_s")

    @property
    def GEMINI_API_KEY(self) -> str:
        return os.environ.get("GEMINI_API_KEY") or self.get("gemini_api_key", "")

    @property
    def GEMINI_MODEL(self) -> str:
        return self.get("gemini_model", "gemini-1.5-flash")

    @property
    def CLAUDE_API_KEY(self) -> str:
        return os.environ.get("ANTHROPIC_API_KEY") or self.get("claude_api_key", "")

    @property
    def CLAUDE_MODEL(self) -> str:
        return self.get("claude_model", "claude-haiku-4-5-20251001")

    @property
    def LOG_PATH(self) -> str:
        return self.get("log_path")

    @property
    def LOG_MAX_LINES(self) -> int:
        return self.get("log_max_lines")

    @property
    def THERMAL_THROTTLE_TEMP_C(self) -> float:
        return self.get("thermal_throttle_temp_c")

    @property
    def THERMAL_THROTTLE_FPS(self) -> int:
        return self.get("thermal_throttle_fps")

    @property
    def WATCHDOG_TIMEOUT_S(self) -> float:
        return self.get("watchdog_timeout_s")

    @property
    def BUTTON_PIN_MODE(self) -> int:
        return self.get("button_pin_mode")

    @property
    def PROMPT_SCENE(self) -> str:
        return self.get("prompt_scene", _DEFAULTS["prompt_scene"])

    @property
    def PROMPT_QRIS(self) -> str:
        return self.get("prompt_qris", _DEFAULTS["prompt_qris"])


# ─── Singleton ────────────────────────────────────────────────────────────────

cfg = Config()

# ─── Backward-compat module-level names ───────────────────────────────────────
# Code that does `from config import X` continues to work unchanged.
# For live-updated values, use `cfg.X` or `cfg.get("x")` directly.

MODEL_PATH            = cfg.MODEL_PATH
CONF_THRESHOLD        = cfg.CONF_THRESHOLD
IOU_THRESHOLD         = cfg.IOU_THRESHOLD
INPUT_WIDTH           = cfg.INPUT_WIDTH
INPUT_HEIGHT          = cfg.INPUT_HEIGHT
CAMERA_FPS            = cfg.CAMERA_FPS
SNAPSHOT_INTERVAL_MS  = cfg.SNAPSHOT_INTERVAL_MS
WEB_HOST              = cfg.WEB_HOST
WEB_PORT              = cfg.WEB_PORT
AI_FOCUS_DURATION_S   = cfg.AI_FOCUS_DURATION_S
AUDIO_DIR             = cfg.AUDIO_DIR
AUDIO_COOLDOWN_S      = cfg.AUDIO_COOLDOWN_S
DANGER_AREA_THRESHOLD = cfg.DANGER_AREA_THRESHOLD
OPENAI_API_KEY        = cfg.OPENAI_API_KEY
OPENAI_MODEL          = cfg.OPENAI_MODEL
OPENAI_TIMEOUT_S      = cfg.OPENAI_TIMEOUT_S
LOG_PATH              = cfg.LOG_PATH
LOG_MAX_LINES         = cfg.LOG_MAX_LINES
PROMPT_SCENE          = cfg.PROMPT_SCENE
PROMPT_QRIS           = cfg.PROMPT_QRIS

RELEVANT_LABELS = {
    "person", "bicycle", "car", "motorcycle", "bus", "truck",
    "dog", "cat", "chair", "bottle", "handbag", "backpack",
}

COCO_LABEL_MAP = {
    0:  "person",       1:  "bicycle",   2:  "car",          3:  "motorcycle",
    4:  "airplane",     5:  "bus",       6:  "train",        7:  "truck",
    14: "bird",         15: "cat",       16: "dog",          17: "horse",
    24: "backpack",     25: "umbrella",  26: "handbag",
    39: "bottle",       56: "chair",     57: "couch",        58: "potted plant",
    62: "tv",           63: "laptop",    64: "mouse",        67: "phone",
}
