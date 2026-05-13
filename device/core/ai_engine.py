"""
AI Engine — Camera capture, NPU inference, result processing.
Runs inside the AI loop thread.

Resource lifecycle
──────────────────
  release_model()   Free YOLO from NPU memory (called when switching to context/qris mode).
  reload_model()    Reload YOLO after mode returns to explorer.
  release()         Full teardown: camera + model (called by watchdog restart).
  reload()          Full reinit: camera + model (watchdog restart_fn).
"""

import time
import base64

try:
    from maix import camera, nn, image
    MAIX_AVAILABLE = True
except ImportError:
    MAIX_AVAILABLE = False

from config import cfg, RELEVANT_LABELS, COCO_LABEL_MAP
from utils.logger import position_from_bbox


class AIEngine:

    def __init__(self, orchestrator, logger):
        self.orch   = orchestrator
        self.logger = logger

        self._cam:          object = None
        self._detector:     object = None
        self._model_loaded: bool   = False
        self._last_frame:   object = None
        self._lock = __import__("threading").Lock()

        self._init_camera()
        self._init_model()

    # ─── Init helpers ─────────────────────────────────────────────────────────

    def _init_camera(self):
        if not MAIX_AVAILABLE:
            self.logger.warn("MaixPy unavailable — camera skipped", module="AIEngine")
            return
        try:
            self._cam = camera.Camera(
                cfg.INPUT_WIDTH, cfg.INPUT_HEIGHT, image.Format.FMT_RGB888
            )
            self._cam.open()
            self.logger.ok(
                f"Camera: {cfg.INPUT_WIDTH}×{cfg.INPUT_HEIGHT} @ {cfg.CAMERA_FPS}fps",
                module="AIEngine",
            )
        except Exception as e:
            self.logger.error(f"Camera init failed: {e}", module="AIEngine")
            self._cam = None

    def _init_model(self):
        if not MAIX_AVAILABLE:
            self.logger.warn("MaixPy unavailable — model skipped", module="AIEngine")
            return
        try:
            self._detector    = nn.YOLO11(model=cfg.MODEL_PATH)
            self._model_loaded = True
            self.logger.ok(f"YOLO11 loaded: {cfg.MODEL_PATH}", module="AIEngine")
        except Exception as e:
            self.logger.error(f"Model load failed: {e}", module="AIEngine")
            self._model_loaded = False

    # ─── Resource management (called by Orchestrator on mode switch) ──────────

    def release_model(self):
        """Unload YOLO from NPU to free memory. Camera stays open."""
        with self._lock:
            if self._detector is not None:
                try:
                    del self._detector
                except Exception:
                    pass
                self._detector     = None
                self._model_loaded = False
                self.logger.info("YOLO model released (NPU free)", module="AIEngine")

    def reload_model(self):
        """Reload YOLO. No-op if already loaded."""
        with self._lock:
            if self._model_loaded:
                return
        self._init_model()

    def release(self):
        """Full teardown — camera + model. Called before watchdog restart."""
        self.release_model()
        with self._lock:
            if self._cam is not None:
                try:
                    self._cam.close()
                except Exception:
                    pass
                self._cam = None

    def reload(self):
        """Full reinit after a crash. Used as watchdog restart_fn."""
        self.logger.warn("Reloading AI Engine (watchdog triggered)", module="AIEngine")
        self.release()
        time.sleep(0.5)
        self._init_camera()
        self._init_model()

    # ─── Main pipeline ────────────────────────────────────────────────────────

    def capture_and_infer(self):
        """
        Capture one frame, run YOLO if loaded, return:
          (jpeg_bytes, detections_list, latency_dict)
        Returns (None, [], {}) on camera failure.
        """
        if not MAIX_AVAILABLE or self._cam is None:
            return None, [], {}

        t0 = time.time()

        # ── Camera read with single auto-recover ──────────────────────────────
        try:
            frame = self._cam.read()
        except RuntimeError as e:
            self.logger.warn(f"Camera read error ({e}) — attempting reopen",
                             module="AIEngine")
            try:
                self._cam.close()
            except Exception:
                pass
            time.sleep(0.3)
            try:
                self._cam.open()
                frame = self._cam.read()
                self.logger.ok("Camera recovered", module="AIEngine")
            except Exception as e2:
                self.logger.error(f"Camera reopen failed: {e2}", module="AIEngine")
                return None, [], {}

        t_cam = (time.time() - t0) * 1000
        self._last_frame = frame

        jpeg = frame.to_jpeg()
        self.orch.snapshot = bytes(jpeg.to_bytes())

        # ── Inference ─────────────────────────────────────────────────────────
        t1         = time.time()
        detections = []
        t_infer    = 0.0

        with self._lock:
            loaded     = self._model_loaded
            detector   = self._detector

        if loaded and detector is not None:
            result  = detector.detect(
                frame,
                conf_th=cfg.CONF_THRESHOLD,
                iou_th=cfg.IOU_THRESHOLD,
            )
            t_infer = (time.time() - t1) * 1000

            t2         = time.time()
            frame_area = cfg.INPUT_WIDTH * cfg.INPUT_HEIGHT

            for det in result:
                label = COCO_LABEL_MAP.get(det.class_id, str(det.class_id))
                if label not in RELEVANT_LABELS:
                    continue

                x, y, w, h   = det.x, det.y, det.w, det.h
                area_ratio   = (w * h) / frame_area
                is_danger    = area_ratio > cfg.DANGER_AREA_THRESHOLD
                pos          = position_from_bbox(
                    x, y, w, h, cfg.INPUT_WIDTH, cfg.INPUT_HEIGHT
                )

                detections.append({
                    "label":      label,
                    "confidence": round(det.score, 3),
                    "position":   pos,
                    "is_danger":  is_danger,
                    "bbox":       {"x": x, "y": y, "w": w, "h": h},
                    "area_ratio": round(area_ratio, 4),
                })

            t_post = (time.time() - t2) * 1000
        else:
            t_post = 0.0

        t_total = (time.time() - t0) * 1000
        latency = {
            "camera_ms":    round(t_cam),
            "inference_ms": round(t_infer),
            "postproc_ms":  round(t_post),
            "total_ms":     round(t_total),
            "fps":          round(1000 / t_total, 1) if t_total > 0 else 0,
        }

        # Send heartbeat so watchdog knows the engine is alive
        if self.orch.watchdog:
            self.orch.watchdog.heartbeat("ai_engine")

        return jpeg, detections, latency

    # ─── Cloud triggers ───────────────────────────────────────────────────────

    def trigger_scene_description(self):
        """Capture last frame → OpenAI Vision → queue audio description."""
        if not cfg.OPENAI_API_KEY:
            self.logger.warn("OPENAI_API_KEY not set", module="AIEngine")
            self.orch.audio_manager.queue_system("api_tidak_tersedia")
            return

        frame = self._last_frame
        if frame is None:
            self.logger.warn("No frame available for scene description",
                             module="AIEngine")
            return

        self.logger.info("Sending frame to OpenAI Vision", module="AIEngine")
        self.orch.audio_manager.queue_system("sedang_menganalisis")

        try:
            import urllib.request, json as _json

            b64 = base64.b64encode(bytes(frame.to_jpeg().to_bytes())).decode()
            payload = {
                "model": cfg.OPENAI_MODEL,
                "messages": [{
                    "role": "user",
                    "content": [
                        {"type": "text", "text": cfg.PROMPT_SCENE},
                        {"type": "image_url",
                         "image_url": {"url": f"data:image/jpeg;base64,{b64}"}},
                    ],
                }],
                "max_tokens": 150,
            }
            req = urllib.request.Request(
                "https://api.openai.com/v1/chat/completions",
                data=_json.dumps(payload).encode(),
                headers={
                    "Content-Type":  "application/json",
                    "Authorization": f"Bearer {cfg.OPENAI_API_KEY}",
                },
                method="POST",
            )
            with urllib.request.urlopen(req, timeout=cfg.OPENAI_TIMEOUT_S) as resp:
                data = _json.loads(resp.read())
            description = data["choices"][0]["message"]["content"].strip()

            self.logger.ok(f"Scene: {description}", module="AIEngine")
            self.orch.audio_manager.queue_info(description)

        except Exception as e:
            self.logger.error(f"OpenAI API error: {e}", module="AIEngine")
            self.orch.audio_manager.queue_system("gagal_menganalisis")

    def trigger_qris_scan(self):
        """Capture last frame → OpenAI Vision → parse QRIS result."""
        if not cfg.OPENAI_API_KEY:
            self.logger.warn("OPENAI_API_KEY not set", module="AIEngine")
            self.orch.audio_manager.queue_system("api_tidak_tersedia")
            return

        frame = self._last_frame
        if frame is None:
            return

        self.logger.info("Scanning QRIS", module="AIEngine")
        self.orch.audio_manager.queue_system("memindai_kode_pembayaran")

        try:
            import urllib.request, json as _json

            b64 = base64.b64encode(bytes(frame.to_jpeg().to_bytes())).decode()
            payload = {
                "model": cfg.OPENAI_MODEL,
                "messages": [{
                    "role": "user",
                    "content": [
                        {"type": "text", "text": cfg.PROMPT_QRIS},
                        {"type": "image_url",
                         "image_url": {"url": f"data:image/jpeg;base64,{b64}"}},
                    ],
                }],
                "max_tokens": 80,
            }
            req = urllib.request.Request(
                "https://api.openai.com/v1/chat/completions",
                data=_json.dumps(payload).encode(),
                headers={
                    "Content-Type":  "application/json",
                    "Authorization": f"Bearer {cfg.OPENAI_API_KEY}",
                },
                method="POST",
            )
            with urllib.request.urlopen(req, timeout=cfg.OPENAI_TIMEOUT_S) as resp:
                data = _json.loads(resp.read())
            result = data["choices"][0]["message"]["content"].strip()

            self.logger.ok(f"QRIS: {result}", module="AIEngine")
            self.orch.audio_manager.queue_info(result)
            self._save_qris_log(result)

        except Exception as e:
            self.logger.error(f"QRIS scan error: {e}", module="AIEngine")
            self.orch.audio_manager.queue_system("gagal_memindai")

    def _save_qris_log(self, result: str):
        import json as _json
        from config import LOG_PATH
        import os

        log_file = os.path.join(LOG_PATH, "qris_log.json")
        os.makedirs(LOG_PATH, exist_ok=True)
        entry = {"timestamp": time.strftime("%Y-%m-%dT%H:%M:%S"), "result": result}
        logs = []
        if os.path.exists(log_file):
            try:
                with open(log_file) as f:
                    logs = _json.load(f)
            except Exception:
                pass
        logs.append(entry)
        with open(log_file, "w") as f:
            _json.dump(logs, f, indent=2, ensure_ascii=False)
