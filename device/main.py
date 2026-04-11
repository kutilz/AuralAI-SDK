"""
AuralAI SDK — Entry Point
Dijalankan di MaixCAM via MaixVision atau: python main.py

Memulai dua thread utama:
  1. AI Loop  — camera → inference → result queue
  2. Web Server — HTTP + snapshot endpoint

Alternatif stack MVP (MaixCAM + companion PC + OpenAI): jalankan `aural_maix.py`
dan ikuti docs/setup.md bagian «Companion PC».
"""

import threading
import time
import sys
import os

# Tambah parent dir ke path agar import relatif bisa dipakai
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from config import WEB_HOST, WEB_PORT
from core.orchestrator import Orchestrator
from server.web_server import WebServer
from utils.logger import Logger


def main():
    logger = Logger()
    logger.info("=" * 50)
    logger.info("AuralAI SDK — Starting up")
    logger.info("=" * 50)

    # Shared state antara thread AI dan Web Server
    orchestrator = Orchestrator(logger=logger)

    # Thread 2: Web Server (selalu jalan)
    web_server = WebServer(
        host=WEB_HOST,
        port=WEB_PORT,
        orchestrator=orchestrator,
        logger=logger,
    )
    web_thread = threading.Thread(
        target=web_server.start,
        daemon=True,
        name="WebServer",
    )
    web_thread.start()
    logger.info(f"Web server started → http://{WEB_HOST}:{WEB_PORT}")

    # Thread 1: AI Loop
    ai_thread = threading.Thread(
        target=orchestrator.run_ai_loop,
        daemon=True,
        name="AILoop",
    )
    ai_thread.start()
    logger.info("AI loop started")

    logger.info("All threads running. Press Ctrl+C to stop.")

    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        logger.info("Shutdown requested — stopping...")
        orchestrator.stop()
        logger.info("AuralAI SDK stopped.")


if __name__ == "__main__":
    main()
