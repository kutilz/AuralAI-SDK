"""
AI Engine — Camera capture, model inference, result processing.
Berjalan di Thread 1 (AI Loop).
"""

import time
import base64

try:
    from maix import camera, nn, image
    MAIX_AVAILABLE = True
except ImportError:
    MAIX_AVAILABLE = False

from config import (
    MODEL_PATH, CONF_THRESHOLD, IOU_THRESHOLD,
    INPUT_WIDTH, INPUT_HEIGHT, CAMERA_FPS,
    OPENAI_API_KEY, OPENAI_MODEL, OPENAI_TIMEOUT_S,
    PROMPT_SCENE, PROMPT_QRIS,
    RELEVANT_LABELS,
)
from utils.logger import position_from_bbox


class AIEngine:
    def __init__(self, orchestrator, logger):
        self.orch = orchestrator
        self.logger = logger
        self._cam = None
        self._detector = None
        self._model_loaded = False
        self._last_frame = None

        self._init_camera()
        self._init_model()

    def _init_camera(self):
        if not MAIX_AVAILABLE:
            self.logger.warn("MaixPy tidak tersedia — kamera tidak diinisialisasi")
            return
        try:
            self._cam = camera.Camera(INPUT_WIDTH, INPUT_HEIGHT, image.Format.FMT_RGB888)
            self._cam.open()
            self.logger.ok(f"Kamera dibuka: {INPUT_WIDTH}x{INPUT_HEIGHT} @ {CAMERA_FPS}fps")
        except Exception as e:
            self.logger.error(f"Gagal inisialisasi kamera: {e}")

    def _init_model(self):
        if not MAIX_AVAILABLE:
            self.logger.warn("MaixPy tidak tersedia — model tidak dimuat")
            return
        try:
            self._detector = nn.YOLOv8(model=MODEL_PATH)
            self._model_loaded = True
            self.logger.ok(f"Model dimuat: {MODEL_PATH}")
        except Exception as e:
            self.logger.error(f"Gagal muat model: {e}")

    def capture_and_infer(self):
        """
        Capture frame dari kamera, jalankan inference, kembalikan hasil.
        Returns: (jpeg_bytes, detections_list, latency_dict)
        """
        if not MAIX_AVAILABLE or self._cam is None:
            return None, [], {}

        t0 = time.time()
        frame = self._cam.read()
        t_cam = (time.time() - t0) * 1000

        # Simpan frame terbaru untuk keperluan scene description / QRIS
        self._last_frame = frame

        # Simpan snapshot JPEG untuk Web UI
        jpeg = frame.to_jpeg()
        self.orch.snapshot = bytes(jpeg)

        t1 = time.time()
        detections = []

        if self._model_loaded:
            result = self._detector.detect(frame, conf_threshold=CONF_THRESHOLD, iou_threshold=IOU_THRESHOLD)
            t_infer = (time.time() - t1) * 1000

            t2 = time.time()
            frame_area = INPUT_WIDTH * INPUT_HEIGHT

            for det in result:
                label = det.class_name
                if label not in RELEVANT_LABELS:
                    continue

                conf = round(det.score, 3)
                x, y, w, h = det.x, det.y, det.w, det.h
                area_ratio = (w * h) / frame_area
                is_danger = area_ratio > 0.15

                pos = position_from_bbox(x, y, w, h, INPUT_WIDTH, INPUT_HEIGHT)

                detections.append({
                    "label": label,
                    "confidence": conf,
                    "position": pos,
                    "is_danger": is_danger,
                    "bbox": {"x": x, "y": y, "w": w, "h": h},
                    "area_ratio": round(area_ratio, 4),
                })

            t_post = (time.time() - t2) * 1000
        else:
            t_infer = 0
            t_post = 0

        t_total = (time.time() - t0) * 1000
        latency = {
            "camera_ms": round(t_cam),
            "inference_ms": round(t_infer),
            "postproc_ms": round(t_post),
            "total_ms": round(t_total),
            "fps": round(1000 / t_total, 1) if t_total > 0 else 0,
        }

        return jpeg, detections, latency

    def trigger_scene_description(self):
        """Capture frame → kirim ke OpenAI Vision → kembalikan deskripsi."""
        if not OPENAI_API_KEY:
            self.logger.warn("OPENAI_API_KEY tidak diset — scene description tidak tersedia")
            self.orch.enqueue_audio("API tidak tersedia")
            return

        frame = self._last_frame
        if frame is None:
            self.logger.warn("Tidak ada frame tersedia untuk dideskripsikan")
            return

        self.logger.info("Mengirim frame ke OpenAI Vision...")
        self.orch.enqueue_audio("sedang menganalisis")

        try:
            import urllib.request
            import json

            jpeg = frame.to_jpeg()
            b64 = base64.b64encode(bytes(jpeg)).decode("utf-8")

            payload = {
                "model": OPENAI_MODEL,
                "messages": [{
                    "role": "user",
                    "content": [
                        {"type": "text", "text": PROMPT_SCENE},
                        {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{b64}"}},
                    ]
                }],
                "max_tokens": 150,
            }

            req = urllib.request.Request(
                "https://api.openai.com/v1/chat/completions",
                data=json.dumps(payload).encode(),
                headers={
                    "Content-Type": "application/json",
                    "Authorization": f"Bearer {OPENAI_API_KEY}",
                },
                method="POST",
            )
            with urllib.request.urlopen(req, timeout=OPENAI_TIMEOUT_S) as resp:
                data = json.loads(resp.read())
                description = data["choices"][0]["message"]["content"].strip()

            self.logger.ok(f"Scene: {description}")
            self.orch.enqueue_audio(description)

        except Exception as e:
            self.logger.error(f"OpenAI API error: {e}")
            self.orch.enqueue_audio("gagal menganalisis scene")

    def trigger_qris_scan(self):
        """Capture frame → kirim ke OpenAI Vision → parse hasil QRIS."""
        if not OPENAI_API_KEY:
            self.logger.warn("OPENAI_API_KEY tidak diset — QRIS tidak tersedia")
            self.orch.enqueue_audio("API tidak tersedia")
            return

        frame = self._last_frame
        if frame is None:
            return

        self.logger.info("Memindai QRIS...")
        self.orch.enqueue_audio("memindai kode pembayaran")

        try:
            import urllib.request
            import json

            jpeg = frame.to_jpeg()
            b64 = base64.b64encode(bytes(jpeg)).decode("utf-8")

            payload = {
                "model": OPENAI_MODEL,
                "messages": [{
                    "role": "user",
                    "content": [
                        {"type": "text", "text": PROMPT_QRIS},
                        {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{b64}"}},
                    ]
                }],
                "max_tokens": 80,
            }

            req = urllib.request.Request(
                "https://api.openai.com/v1/chat/completions",
                data=json.dumps(payload).encode(),
                headers={
                    "Content-Type": "application/json",
                    "Authorization": f"Bearer {OPENAI_API_KEY}",
                },
                method="POST",
            )
            with urllib.request.urlopen(req, timeout=OPENAI_TIMEOUT_S) as resp:
                data = json.loads(resp.read())
                result = data["choices"][0]["message"]["content"].strip()

            self.logger.ok(f"QRIS result: {result}")
            self.orch.enqueue_audio(result)

            # Simpan ke log
            self._save_qris_log(result)

        except Exception as e:
            self.logger.error(f"QRIS scan error: {e}")
            self.orch.enqueue_audio("gagal memindai kode")

    def _save_qris_log(self, result):
        import json
        import os
        from config import LOG_PATH

        log_file = os.path.join(LOG_PATH, "qris_log.json")
        os.makedirs(LOG_PATH, exist_ok=True)

        entry = {
            "timestamp": time.strftime("%Y-%m-%dT%H:%M:%S"),
            "result": result,
        }

        logs = []
        if os.path.exists(log_file):
            try:
                with open(log_file, "r") as f:
                    logs = json.load(f)
            except Exception:
                logs = []

        logs.append(entry)

        with open(log_file, "w") as f:
            json.dump(logs, f, indent=2, ensure_ascii=False)
