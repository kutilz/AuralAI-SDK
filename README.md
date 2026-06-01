# AuralAI SDK

> On-device development platform for AI-powered visual assistants running on the **Sipeed MaixCAM**.  
> Designed to help visually impaired users recognize their surroundings via audio.

---

## Features

| Phase  | Feature                                                                       | Status                                  |
| ------ | ----------------------------------------------------------------------------- | --------------------------------------- |
| **0**  | Web Dashboard, Camera Preview, Log Stream                                     | ✅ Ready                                 |
| **0b** | Companion PC (MaixCAM + Flask, tested MVP)                                    | ✅ `companion/` + `device/aural_maix.py` |
| **1**  | Object Detection (YOLO11n COCO), Audio Output, Explorer Mode                  | ✅ Ready                                 |
| **2**  | Scene Description (AI Vision), QRIS Verifier, Token Auth, Presets             | ✅ Ready                                 |
| **3**  | Hybrid TTS, Log Rotation, Benchmark Suite, Data Collection, Audio Progress    | ✅ Ready                                 |
| **4**  | Companion UI Redesign — `/` companion, `/admin`, `/guide`, `/setup`          | ✅ Ready                                 |

---

## Architecture

**Path A — Dashboard on MaixCAM** (`device/main.py`):

```
MaixCAM Device
├── Thread 1 — AI Loop      → Camera → YOLO Inference → Detection Queue
└── Thread 2 — Web Server   → HTTP Dashboard + Snapshot Endpoint
                                        │
                               Browser (Phone / Laptop)
                               AuralAI Dev Dashboard
```

**Path B — Companion PC** (`device/aural_maix.py` + `companion/webserver.py`):

```
MaixCAM (Screen UI + Local YOLO) ──HTTP──► PC Flask (OpenAI Vision, MJPEG, Browser TTS)
                               └──► Browser observer (http://PC-IP:5000)
```

For setup details, see the *Companion PC* and *Network Testing* sections in [docs/setup.md](docs/setup.md).

---

## Quick Start

```bash
# 1. Clone the repository
git clone https://github.com/<username>/AuralAI-SDK.git
cd AuralAI-SDK

# 2. Install PC dependencies
pip install -r requirements_pc.txt

# 3. Generate audio files
python tools/generate_audio.py

# 4. Deploy to MaixCAM
python tools/deploy.py

# 5. Access the dashboard
# Open your browser → http://maixcam.local:8080
```

### Preview Mockup (No Hardware Required)

Open `device/server/static/index.html` directly in your browser — the dashboard runs fully in simulation mode.

### Companion PC (MVP + OpenAI on PC)

```bash
pip install -r requirements_pc.txt
cp companion/.env.example companion/.env   # On Windows: copy companion\.env.example companion\.env
# Edit companion/.env and fill in your OPENAI_API_KEY
python companion/webserver.py
python companion/run_desktop.py            # Optional: Simulate with webcam
```

On your MaixCAM, set `AURAL_COMPANION_HOST` to your **PC's IPv4 address** (Wi‑Fi/Ethernet, not WSL IP), then run `python aural_maix.py` — see [docs/setup.md](docs/setup.md) for details.

---

## Project Structure

```
aural-ai-sdk/
├── companion/                # PC-side server + desktop runner (MVP)
│   ├── webserver.py          # Flask + dashboard + API for device
│   ├── minimal_server.py     # Connection test: MaixCAM ↔ PC (without OpenAI)
│   ├── run_desktop.py        # Simulate MaixCAM using a webcam
│   └── .env.example
├── device/                   # Code for MaixCAM (Python/MaixPy)
│   ├── main.py               # Main entry point
│   ├── aural_maix.py         # Alternative entry: UI + YOLO + companion hub
│   ├── wifi_connect.py       # WiFi helper (official MaixPy pattern, used by probe & aural_maix)
│   ├── network_probe.py      # HTTP connection test to PC (used with minimal_server)
│   ├── config.py             # Configuration constants
│   ├── core/
│   │   ├── orchestrator.py   # State machine, shared state
│   │   ├── ai_engine.py      # Camera + inference
│   │   └── audio_manager.py  # Audio queue & playback
│   ├── modes/
│   │   ├── explorer_mode.py  # Offline object detection
│   │   └── context_mode.py   # Online OpenAI mode
│   ├── server/
│   │   ├── web_server.py     # HTTP server
│   │   ├── routes.py         # API endpoints (documentation only)
│   │   ├── static/           # Static assets
│   │   │   ├── index.html    # Old operator dashboard (served at /admin/legacy)
│   │   │   ├── tokens.css    # Design tokens — single source of truth
│   │   │   └── app/          # Output of `vite build` (committed to repo)
│   │   └── src/              # Preact + Vite source for /, /admin, /guide, /setup
│   └── utils/
│       ├── logger.py
│       └── latency_tester.py
├── tools/                    # PC-side scripts
│   ├── generate_audio.py     # Pre-generate WAV files via gTTS
│   ├── deploy.py             # SCP deploy tool for MaixCAM
│   └── model_converter.py    # Model helper (Phase 3)
├── models/                   # Model files (not committed)
├── audio/                    # Generated WAV files (not committed)
├── docs/
│   └── setup.md
├── requirements_pc.txt
└── README.md
```

---

## API Endpoints

### Pages (Phase 4 Redesign)

| Method | Endpoint        | Function                                           | Auth |
| ------ | --------------- | -------------------------------------------------- | ---- |
| `GET`  | `/`             | Companion dashboard (redirects to `/setup` on first-time launch) | Optional |
| `GET`  | `/admin`        | Admin dashboard (companion + dev sidebar)         | `device_token` (or `admin_role_token` if set) |
| `GET`  | `/guide`        | Public user guide                                  | None |
| `GET`  | `/setup`        | 4-step setup wizard                                | Optional |
| `GET`  | `/admin/legacy` | Old operator dashboard (fallback debug page)       | Optional |
| `GET`  | `/tokens.css`   | Design tokens (single source of truth)             | None |
| `GET`  | `/app/<...>`    | Hashed JS/CSS from Vite build                      | None |

### Data API

| Method | Endpoint                          | Function                                            |
| ------ | --------------------------------- | --------------------------------------------------- |
| `GET`  | `/snapshot`                       | Latest JPEG frame                                   |
| `GET`  | `/status`                         | JSON: mode, detections, latency, battery, wifi, audio_mode, last_caption, setup_completed |
| `GET`  | `/logs`                           | Latest log lines (last 50 lines)                    |
| `GET`  | `/history?date=today`             | Activity feed for companion dashboard               |
| `GET`  | `/health`                         | Hardware health metrics                             |
| `GET`  | `/audio/{file}`                   | Serves WAV files                                    |
| `GET`  | `/audio/chimes/manifest.json`     | List of available chimes                            |
| `GET`  | `/assets/manifest.json`           | List of photo assets                                |
| `GET`  | `/assets/{name}`                  | Serves photo assets (falls back to mock SVG in UI)  |
| `POST` | `/command`                        | `{"cmd": "focus"\|"capture"\|"qris"\|"describe"\|"set_mode"}` |
| `POST` | `/config`                         | Updates config (audio_volume, audio_mode, setup_completed, etc) |

---

## UI Development

The UI source code is located in `device/server/src/` (built with Preact + Vite). The build output is committed to `device/server/static/app/` because the MaixCAM device does not run Node.js.

```bash
cd device/server/src
npm install                 # Run once
npm run build               # Generates ../static/app/{companion,admin,guide,setup}.html + assets/
npm run dev                 # Dev server on http://localhost:5173 (proxies /status, /snapshot, etc. to localhost:8080)
```

After running `npm run build`, commit the `static/app/` directory alongside your source changes.
For details on adding English language translations, refer to [`device/server/src/README.md`](device/server/src/README.md).

---

## Configuration

Edit `device/config.py` before deploying:

```python
MODEL_PATH        = "/root/models/yolo11n.mud"
CONF_THRESHOLD    = 0.5
CAMERA_FPS        = 30
WEB_PORT          = 8080
AI_FOCUS_DURATION = 5        # seconds
AUDIO_COOLDOWN_S  = 2.0      # cooldown between identical audio cues
OPENAI_MODEL      = "gpt-4o-mini"
```

---

## Hardware

- **Device:** Sipeed MaixCAM (regular variant)
- **Camera:** Built-in sensor (320×224 resolution, RGB888 format)
- **Network:** WiFi connection (HTTP server running on port 8080)
- **Storage:** MicroSD card for models, audio files, and system logs

---

## License

MIT License — free to use, modify, and distribute.

---

> Refer to [docs/setup.md](docs/setup.md) for the complete setup guide.
