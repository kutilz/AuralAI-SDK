# AuralAI SDK

> Platform pengembangan on-device untuk asisten visual berbasis AI yang berjalan di **Sipeed MaixCAM**.  
> Dirancang untuk membantu pengguna tunanetra mengenali lingkungan sekitar melalui audio.

---

## Fitur

| Phase  | Fitur                                                                         | Status                                  |
| ------ | ----------------------------------------------------------------------------- | --------------------------------------- |
| **0**  | Web Dashboard, Camera Preview, Log Stream                                     | ✅ Ready                                 |
| **0b** | Companion PC (MaixCAM + Flask, MVP teruji)                                    | ✅ `companion/` + `device/aural_maix.py` |
| **1**  | Object Detection (YOLO11n COCO), Audio Output, Explorer Mode                  | ✅ Ready                                 |
| **2**  | Scene Description (AI Vision), QRIS Verifier, Token Auth, Presets             | ✅ Ready                                 |
| **3**  | TTS Hybrid, Log Rotation, Benchmark Suite, Data Collection, Audio Progress    | ✅ Ready                                 |
| **4**  | Companion UI Redesign — `/` pendamping, `/admin`, `/guide`, `/setup`          | ✅ Ready                                 |

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
│   │   ├── routes.py         # API endpoints (doc only)
│   │   ├── static/           # Static files
│   │   │   ├── index.html    # Dashboard operator lama (served at /admin/legacy)
│   │   │   ├── tokens.css    # Design tokens — sumber tunggal
│   │   │   └── app/          # Hasil `vite build` (committed)
│   │   └── src/              # Preact + Vite source untuk /, /admin, /guide, /setup
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

### Halaman (Phase 4 redesign)

| Method | Endpoint        | Fungsi                                            | Auth |
| ------ | --------------- | ------------------------------------------------- | ---- |
| `GET`  | `/`             | Companion dashboard (redirect ke `/setup` saat first-time) | optional |
| `GET`  | `/admin`        | Admin dashboard (companion + dev sidebar)         | `device_token` (atau `admin_role_token` kalau di-set) |
| `GET`  | `/guide`        | Panduan publik                                    | none |
| `GET`  | `/setup`        | Setup wizard 4 langkah                            | optional |
| `GET`  | `/admin/legacy` | Operator dashboard lama (fallback debug)          | optional |
| `GET`  | `/tokens.css`   | Design tokens (sumber tunggal)                    | none |
| `GET`  | `/app/<...>`    | Hashed JS/CSS dari Vite build                     | none |

### Data API

| Method | Endpoint                          | Fungsi                                              |
| ------ | --------------------------------- | --------------------------------------------------- |
| `GET`  | `/snapshot`                       | JPEG frame terbaru                                  |
| `GET`  | `/status`                         | JSON: mode, detections, latency, battery, wifi, audio_mode, last_caption, setup_completed |
| `GET`  | `/logs`                           | Log terbaru (50 baris)                              |
| `GET`  | `/history?date=today`             | Activity feed untuk dashboard pendamping            |
| `GET`  | `/health`                         | Hardware health metrics                             |
| `GET`  | `/audio/{file}`                   | Serve WAV file                                      |
| `GET`  | `/audio/chimes/manifest.json`     | Daftar chime yang tersedia                          |
| `GET`  | `/assets/manifest.json`           | Daftar foto asset                                   |
| `GET`  | `/assets/{name}`                  | Serve foto asset (fallback ke SVG mockup di UI)     |
| `POST` | `/command`                        | `{"cmd": "focus"\|"capture"\|"qris"\|"describe"\|"set_mode"}` |
| `POST` | `/config`                         | Update config (audio_volume, audio_mode, setup_completed, dll) |

---

## Build UI

Source UI ada di `device/server/src/` (Preact + Vite). Output build di-commit ke
`device/server/static/app/` karena MaixCAM tidak punya Node.js.

```bash
cd device/server/src
npm install                 # sekali
npm run build               # menghasilkan ../static/app/{companion,admin,guide,setup}.html + assets/
npm run dev                 # dev server di http://localhost:5173 (proxy /status, /snapshot, dll ke localhost:8080)
```

Setelah `npm run build`, commit ulang folder `static/app/` bersama perubahan source.
Detail + cara menambah bahasa Inggris: lihat [`device/server/src/README.md`](device/server/src/README.md).

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
