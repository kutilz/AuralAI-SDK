"""
Explorer Mode — Offline object detection dengan YOLO.
Dipanggil per-tick dari AI loop di orchestrator.
"""

import time


def run_explorer_tick(orch):
    """
    Satu siklus Explorer Mode:
    1. Capture + inference
    2. Update detections di orchestrator
    3. Queue audio untuk objek terdeteksi
    4. Update latency stats
    """
    if orch.ai_engine is None:
        time.sleep(0.1)
        return

    _, detections, latency = orch.ai_engine.capture_and_infer()

    orch.detections = detections
    orch.latency = latency

    # Queue audio untuk deteksi terbaru
    if detections and orch.audio_manager:
        # Sort by: danger dulu, lalu confidence tertinggi
        sorted_dets = sorted(
            detections,
            key=lambda d: (d.get("is_danger", False), d.get("confidence", 0)),
            reverse=True,
        )

        # Hanya queue objek paling relevan (maks 2)
        for det in sorted_dets[:2]:
            orch.audio_manager.queue_object(
                label=det["label"],
                position=det["position"],
            )
