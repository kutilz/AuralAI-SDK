# AuralAI SDK — Changelog

---

## [Phase 3] — 2026-05-14

### AI Vision API Adapters
- **New: `device/adapters/` package** with unified `AIAdapter` base class and three provider implementations:
  - `OpenAIAdapter` — Chat Completions with `image_url` (base64 inline); `gpt-4o-mini` default
  - `GeminiAdapter` — `generateContent` REST v1beta with `inlineData`; `gemini-1.5-flash` default
  - `ClaudeAdapter` — Anthropic Messages API with `image` content blocks; `claude-haiku-4-5` default
  - All adapters share `describe_scene()`, `scan_qris()`, and `test_connection()` interface
  - Factory function `get_adapter(provider, cfg)` selects adapter based on active provider
- **Updated `device/core/ai_engine.py`** — replaced hardcoded OpenAI calls in `trigger_scene_description()` and `trigger_qris_scan()` with `get_adapter(cfg.AI_PROVIDER, cfg)`; no structural changes to the inference pipeline

### Config Changes
- **Updated `device/config.py`**:
  - New keys: `ai_provider` ("openai"/"gemini"/"claude"), `ai_timeout_s`, `gemini_api_key`, `gemini_model`, `claude_api_key`, `claude_model`
  - `prompt_scene` and `prompt_qris` moved from class-level string constants → runtime-editable config keys (backed by `/root/config.json`)
  - New typed properties: `AI_PROVIDER`, `AI_TIMEOUT_S`, `GEMINI_API_KEY`, `GEMINI_MODEL`, `CLAUDE_API_KEY`, `CLAUDE_MODEL`, `PROMPT_SCENE`, `PROMPT_QRIS`

### Web UI — AI Settings
- **New `GET /ai-settings`** — returns active provider, model names, key presence hints (last 4 chars), and prompts; API keys are never returned in full
- **New `POST /ai-settings`** — saves provider/model/key/prompt changes; empty key fields are ignored (no accidental key erasure)
- **New `POST /ai-settings/test`** — tests live connectivity to the configured adapter using a minimal text-only call
- **Updated `device/server/static/index.html`** — "AI Settings" button in controls bar; full settings modal with provider selector tabs, model dropdowns, masked API key inputs, editable prompts, test button, and save/cancel
- **Updated `device/server/static/style.css`** — styles for AI settings modal, provider tab buttons, key hint, test result badge

### Bug Fixes
- **`device/utils/health.py` — I2C battery HAT probing**: probes `/dev/i2c-1`/`/dev/i2c-2` at addresses 0x36/0x40 on import; `battery_hat_present()` and `battery_info()` return empty dict silently if no HAT is found — no more `OSError` at startup and battery audio warnings are disabled automatically
- **`device/core/audio_manager.py` — `player.stop()` AttributeError**: `_play_pcm()` now catches `AttributeError` separately from other exceptions; when `stop()` is missing the method returns immediately so the higher-priority task starts without waiting for the full PCM deadline
- **`device/core/audio_manager.py` — `_current_text` tracking**: new `current_text` property (thread-safe) exposes the text currently being played; set on `_play_task` entry, cleared on exit
- **`device/core/orchestrator.py` — `audio_text` in status**: `get_status()` now includes `"audio_text"` from `audio_manager.current_text` so the `/status` endpoint delivers the playing text without the removed `pop_audio()` deque
- **`device/server/web_server.py` — simplified `_serve_status()`**: removed the now-redundant `pop_audio()` call; `audio_text` arrives directly from `get_status()`
- **`device/server/static/dashboard.js` — removed Web Speech API**: `showAudioText()` is now a pure visual log update; `window.speechSynthesis` calls removed entirely; device speaker is the only audio output

---

## [Phase 2] — 2026-05-13

### Standardized Benchmark Suite
- **`device/benchmark/t1_latency.py`** — End-to-End Latency: measures cam/infer/post/queue stages; p95 < 300 ms to pass; score 0–100
- **`device/benchmark/t2_accuracy.py`** — Detection Accuracy: recall/precision on `/root/test_images/`; critical recall ≥ 95%; skips gracefully if no dataset
- **`device/benchmark/t3_audio.py`** — Audio Priority: simulates CRITICAL→LOW interrupt (must succeed within 150 ms); PriorityQueue ordering; cooldown isolation
- **`device/benchmark/t4_stability.py`** — Hardware Stability: full pipeline endurance for configurable duration; FPS ≥ 15 and zero crashes to pass; per-minute snapshots
- **`device/benchmark/report.py`** — Safety & Reliability Index: weighted sum T1×35% + T2×30% + T3×20% + T4×15%; grades A/B/C/D/F; Indonesian recommendations
- **`device/benchmark/run_all.py`** — CLI entry point; `--tests`, `--t1-frames`, `--t4-duration`, `--report-only`; live progress to `/tmp/bench_suite_progress.json`
- **`device/server/web_server.py`** — added `BenchmarkSuiteRunner` class and `/suite/start`, `/suite/stop`, `/suite/progress`, `/suite/report` endpoints

---

## [Phase 1] — 2026-05-12

### Core Rewrite — Real Hardware Integration

#### `device/config.py`
- Full rewrite as thread-safe `Config` singleton backed by `/root/config.json`
- `cfg.update(mapping)` persists to disk; all config keys runtime-updatable
- Backward-compat module-level aliases (`from config import X` still works)

#### `device/core/orchestrator.py`
- Event-driven state machine replacing polling loop
- `switch_mode()` releases/reloads NPU model based on `_YOLO_MODES`
- GPIO hardware button listener (falling-edge, 0.3 s debounce) via `cfg.button_pin_mode`
- Thermal throttle callbacks (`_on_thermal_throttle`, `_on_thermal_recover`)
- `_mode_event` (threading.Event) for zero-latency mode-change wakeup in AI loop

#### `device/core/ai_engine.py`
- NPU inference via `maix.nn.YOLO11`
- `release_model()` / `reload_model()` for mode-switch memory management
- `release()` / `reload()` as watchdog restart functions
- Single auto-recover on camera `RuntimeError`
- Watchdog heartbeat on every successful pipeline tick

#### `device/core/audio_manager.py`
- Non-blocking `threading.PriorityQueue` with levels CRITICAL(0)/HIGH(1)/NORMAL(2)/LOW(3)
- `_interrupt` event for immediate higher-priority preemption
- Cooldown map per label; per-priority stable ordering via sequence counter
- WAV → PCM s16le 48 kHz conversion via ffmpeg (cached)

#### `device/utils/health.py`
- Added `HealthMonitor` daemon: polls every 5 s; fires `on_throttle`/`on_recover` callbacks

#### `device/utils/logger.py`
- Structured JSON logging: `{"ts":…, "level":…, "module":…, "msg":…}`

#### `device/core/watchdog.py` (new)
- Heartbeat-based watchdog; `max_misses × check_interval_s` before `restart_fn()` is called

#### `device/main.py`
- Wires Watchdog, HealthMonitor, Orchestrator, WebServer together

#### `device/server/web_server.py`
- `_handle_config()` now calls `cfg.update(data)` (was a no-op)
- `pop_audio()` stub on Orchestrator for backward-compat (returns None)
