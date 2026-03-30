# AuralAI SDK — Semua konstanta dan konfigurasi
# Edit file ini sebelum deploy ke MaixCAM.

import os

# ─── Model ────────────────────────────────────────────────────────────────────
MODEL_PATH          = "/root/models/yolo11n.mud"
CONF_THRESHOLD      = 0.5
IOU_THRESHOLD       = 0.45
INPUT_WIDTH         = 320
INPUT_HEIGHT        = 224

# ─── Camera ───────────────────────────────────────────────────────────────────
CAMERA_FPS          = 30
SNAPSHOT_INTERVAL_MS = 500   # Interval refresh Web UI (ms)

# ─── Web Server ───────────────────────────────────────────────────────────────
WEB_HOST            = "0.0.0.0"
WEB_PORT            = 8080

# ─── AI Focus Mode ────────────────────────────────────────────────────────────
AI_FOCUS_DURATION_S = 5      # Durasi AI Focus (detik)

# ─── Audio ────────────────────────────────────────────────────────────────────
AUDIO_DIR           = "/root/audio"
AUDIO_COOLDOWN_S    = 2.0    # Jeda minimum antar audio yang sama (detik)

# ─── Danger Zone ──────────────────────────────────────────────────────────────
# Objek dianggap berbahaya jika bounding box > threshold ini (% frame area)
DANGER_AREA_THRESHOLD = 0.15

# ─── Online Mode (Context Mode) ───────────────────────────────────────────────
# JANGAN hardcode API key di sini — load dari environment variable
OPENAI_API_KEY      = os.environ.get("OPENAI_API_KEY", "")
OPENAI_MODEL        = "gpt-4o-mini"
OPENAI_TIMEOUT_S    = 10

# Prompt untuk scene description
PROMPT_SCENE = (
    "Deskripsikan scene ini secara singkat dalam Bahasa Indonesia, "
    "fokus pada objek yang relevan untuk pengguna tunanetra. "
    "Maksimal 2 kalimat."
)

# Prompt untuk QRIS verifier
PROMPT_QRIS = (
    "Baca kode QRIS ini. Sebutkan: nama merchant dan nominal jika ada. "
    "Format: MERCHANT: [nama], NOMINAL: [angka]. "
    "Jika bukan QRIS, jawab: BUKAN QRIS."
)

# ─── Logging ──────────────────────────────────────────────────────────────────
LOG_PATH            = "/root/logs"
LOG_MAX_LINES       = 500

# ─── COCO Labels yang relevan (subset) ────────────────────────────────────────
RELEVANT_LABELS = {
    "person", "bicycle", "car", "motorcycle", "bus", "truck",
    "dog", "cat", "chair", "bottle", "handbag", "backpack",
}

# Label ID di COCO 80-class (untuk filter inference result)
COCO_LABEL_MAP = {
    0: "person", 1: "bicycle", 2: "car", 3: "motorcycle",
    4: "airplane", 5: "bus", 6: "train", 7: "truck",
    14: "bird", 15: "cat", 16: "dog", 17: "horse",
    24: "backpack", 25: "umbrella", 26: "handbag",
    39: "bottle", 56: "chair", 57: "couch", 58: "potted plant",
    62: "tv", 63: "laptop", 64: "mouse", 67: "phone",
}
