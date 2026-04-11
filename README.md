# AuralAI SDK

> Platform pengembangan on-device untuk asisten visual berbasis AI yang berjalan di **Sipeed MaixCAM**.  
> Dirancang untuk membantu pengguna tunanetra mengenali lingkungan sekitar melalui audio.

---

## Fitur

| Phase | Fitur | Status |
|-------|-------|--------|
| **0** | Web Dashboard, Camera Preview, Log Stream | ✅ Ready |
| **0b** | Companion PC (MaixCAM + Flask, MVP teruji) | ✅ `companion/` + `device/aural_maix.py` |
| **1** | Object Detection (YOLO11n COCO), Audio Output, AI Focus Mode | 🔧 In Progress |
| **2** | Scene Description (OpenAI Vision), QRIS Verifier | 📋 Planned |
| **3** | Custom Model Pipeline, Dataset Capture Tool | 📋 Planned |

---

## Arsitektur

**Jalur A — dashboard di MaixCAM** (`device/main.py`):

```
MaixCAM Device
├── Thread 1 — AI Loop      → Camera → YOLO Inference → Detection Queue
└── Thread 2 — Web Server   → HTTP Dashboard + Snapshot Endpoint
                                        │
                              Browser (HP / Laptop)
                              AuralAI Dev Dashboard
```

**Jalur B — Companion PC** (`device/aural_maix.py` + `companion/webserver.py`):

```
MaixCAM (UI layar + YOLO lokal) ──HTTP──► PC Flask (OpenAI Vision, MJPEG, TTS browser)
                              └──► Browser observer (http://IP-PC:5000)
```

Detail setup: [docs/setup.md](docs/setup.md) bagian *Companion PC* dan *Uji jaringan*.

---

## Quick Start

```bash
# 1. Clone
git clone https://github.com/<username>/AuralAI-SDK.git
cd AuralAI-SDK

# 2. Install PC deps
pip install -r requirements_pc.txt

# 3. Generate audio files
python tools/generate_audio.py

# 4. Deploy ke MaixCAM
python tools/deploy.py

# 5. Akses dashboard
# Buka browser → http://maixcam.local:8080
```

### Preview Mockup (Tanpa Hardware)

Buka `device/server/static/index.html` langsung di browser — dashboard berjalan penuh dalam mode simulasi.

### Companion PC (MVP + OpenAI di PC)

```bash
pip install -r requirements_pc.txt
cp companion/.env.example companion/.env   # Windows: copy ...
# Edit companion/.env — isi OPENAI_API_KEY
python companion/webserver.py
python companion/run_desktop.py            # opsional: simulasi webcam
```

Di MaixCAM set `AURAL_COMPANION_HOST` ke **IPv4 Wi‑Fi/Ethernet PC** (bukan IP WSL), lalu `python aural_maix.py` — lihat [docs/setup.md](docs/setup.md).

---

## Struktur Project

```
aural-ai-sdk/
├── companion/                # Server PC + runner desktop (MVP)
│   ├── webserver.py          # Flask + dashboard + API untuk device
│   ├── minimal_server.py     # Uji koneksi MaixCAM ↔ PC (tanpa OpenAI)
│   ├── run_desktop.py        # Simulasi MaixCAM dengan webcam
│   └── .env.example
├── device/                   # Kode untuk MaixCAM (Python/MaixPy)
│   ├── main.py               # Entry point
│   ├── aural_maix.py         # Entry alternatif: UI + YOLO + hub ke companion
│   ├── wifi_connect.py       # Helper WiFi (pola resmi MaixPy, dipakai probe + aural_maix)
│   ├── network_probe.py      # Uji HTTP ke PC (pakai dengan minimal_server)
│   ├── config.py             # Semua konstanta
│   ├── core/
│   │   ├── orchestrator.py   # State machine, shared state
│   │   ├── ai_engine.py      # Camera + inference
│   │   └── audio_manager.py  # Audio queue & playback
│   ├── modes/
│   │   ├── explorer_mode.py  # Offline object detection
│   │   └── context_mode.py   # Online OpenAI mode
│   ├── server/
│   │   ├── web_server.py     # HTTP server
│   │   ├── routes.py         # API endpoints
│   │   └── static/           # Web Dashboard (HTML/CSS/JS)
│   └── utils/
│       ├── logger.py
│       └── latency_tester.py
├── tools/                    # Script PC-side
│   ├── generate_audio.py     # Pre-generate WAV via gTTS
│   ├── deploy.py             # SCP deploy ke MaixCAM
│   └── model_converter.py    # Model helper (Phase 3)
├── models/                   # Model files (tidak di-commit)
├── audio/                    # Generated WAV (tidak di-commit)
├── docs/
│   └── setup.md
├── requirements_pc.txt
└── README.md
```

---

## API Endpoints

| Method | Endpoint | Fungsi |
|--------|----------|--------|
| `GET` | `/` | Web Dashboard |
| `GET` | `/snapshot` | JPEG frame terbaru |
| `GET` | `/status` | JSON: mode, detections, latency |
| `POST` | `/command` | `{"cmd": "focus"\|"capture"\|"qris"\|"describe"}` |
| `GET` | `/audio/{file}` | Serve WAV file |
| `GET` | `/logs` | Log terbaru (50 baris) |
| `POST` | `/config` | Update konfigurasi |

---

## Konfigurasi

Edit `device/config.py` sebelum deploy:

```python
MODEL_PATH        = "/root/models/yolo11n.mud"
CONF_THRESHOLD    = 0.5
CAMERA_FPS        = 30
WEB_PORT          = 8080
AI_FOCUS_DURATION = 5        # detik
AUDIO_COOLDOWN_S  = 2.0      # jeda antar audio sama
OPENAI_MODEL      = "gpt-4o-mini"
```

---

## Hardware

- **Device:** Sipeed MaixCAM (regular)
- **Camera:** Built-in (320×224, RGB888)
- **Network:** WiFi (HTTP server port 8080)
- **Storage:** SD Card untuk model, audio, dan logs

---

## Lisensi

MIT License — bebas digunakan dan dimodifikasi.

---

> Lihat [docs/setup.md](docs/setup.md) untuk panduan instalasi lengkap.
