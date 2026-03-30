"""
Audio Generator — PC-side script untuk pre-generate semua file WAV.
Jalankan sekali di laptop sebelum deploy ke MaixCAM.

Requires: pip install gtts
Output:   ../audio/obj_*.wav + ../audio/system_*.wav

Usage:
    python tools/generate_audio.py
    python tools/generate_audio.py --lang id --output ../audio
    python tools/generate_audio.py --dry-run   (hanya list tanpa generate)
"""

import os
import sys
import time
import argparse

OUTPUT_DIR = os.path.join(os.path.dirname(__file__), "..", "audio")

# ─── Label & Posisi ───────────────────────────────────────────────────────────

OBJECTS = {
    "person":     "orang",
    "motorcycle": "motor",
    "car":        "mobil",
    "bicycle":    "sepeda",
    "bus":        "bus",
    "truck":      "truk",
    "dog":        "anjing",
    "cat":        "kucing",
    "chair":      "kursi",
    "bottle":     "botol",
    "handbag":    "tas",
    "backpack":   "ransel",
}

POSITIONS = {
    "left":         "di sebelah kiri",
    "right":        "di sebelah kanan",
    "center":       "di depan",
    "top_left":     "di kiri atas",
    "top_right":    "di kanan atas",
    "top":          "di atas",
    "bottom":       "di bawah",
    "bottom_left":  "di kiri bawah",
    "bottom_right": "di kanan bawah",
}

SYSTEM_EVENTS = {
    "mode_explorer_aktif":  "mode penjelajah aktif",
    "mode_context_aktif":   "mode konteks aktif",
    "mode_qris_aktif":      "mode scan bayar aktif",
    "sedang_menganalisis":  "sedang menganalisis",
    "selesai":              "selesai",
    "koneksi_gagal":        "koneksi gagal",
    "baterai_lemah":        "baterai lemah",
    "tidak_ada_deteksi":    "tidak ada objek terdeteksi",
    "api_tidak_tersedia":   "API tidak tersedia",
    "gagal_menganalisis":   "gagal menganalisis",
}


def build_audio_list():
    """Buat list semua (filename, text) yang perlu di-generate."""
    items = []

    # Object detection audio
    for obj_key, obj_id in OBJECTS.items():
        for pos_key, pos_id in POSITIONS.items():
            filename = f"obj_{obj_key}_{pos_key}.wav"
            text = f"{obj_id} {pos_id}"
            items.append((filename, text))

    # System events
    for event_key, event_text in SYSTEM_EVENTS.items():
        filename = f"system_{event_key}.wav"
        items.append((filename, event_text))

    return items


def generate_all(output_dir, lang="id", dry_run=False, delay=0.5):
    try:
        from gtts import gTTS
    except ImportError:
        print("ERROR: gTTS tidak terinstall. Jalankan: pip install gtts")
        sys.exit(1)

    os.makedirs(output_dir, exist_ok=True)
    items = build_audio_list()

    print(f"Akan generate {len(items)} file WAV ke: {output_dir}")
    print(f"Lang: {lang} | Dry run: {dry_run}\n")

    existing = 0
    generated = 0
    failed = 0

    for i, (filename, text) in enumerate(items):
        out_path = os.path.join(output_dir, filename)

        if os.path.exists(out_path):
            print(f"  [{i+1:3d}/{len(items)}] SKIP  {filename}")
            existing += 1
            continue

        if dry_run:
            print(f"  [{i+1:3d}/{len(items)}] DRY   {filename} → \"{text}\"")
            continue

        try:
            tts = gTTS(text=text, lang=lang, slow=False)
            tts.save(out_path)
            print(f"  [{i+1:3d}/{len(items)}] OK    {filename} → \"{text}\"")
            generated += 1
            time.sleep(delay)  # Jeda untuk hindari rate limit
        except Exception as e:
            print(f"  [{i+1:3d}/{len(items)}] FAIL  {filename} → {e}")
            failed += 1

    print(f"\nSelesai!")
    print(f"  Generated : {generated}")
    print(f"  Skipped   : {existing}")
    print(f"  Failed    : {failed}")
    print(f"  Total     : {len(items)}")

    if not dry_run and generated > 0:
        print(f"\nFile tersimpan di: {os.path.abspath(output_dir)}")
        print("Selanjutnya: upload folder audio/ ke MaixCAM di /root/audio/")
        print("  Gunakan: python tools/deploy.py --audio-only")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="AuralAI Audio Generator (gTTS)")
    parser.add_argument("--output", default=OUTPUT_DIR, help="Output directory")
    parser.add_argument("--lang", default="id", help="Language code (default: id)")
    parser.add_argument("--delay", type=float, default=0.5, help="Delay antar request (default: 0.5s)")
    parser.add_argument("--dry-run", action="store_true", help="List saja tanpa generate")
    args = parser.parse_args()

    generate_all(
        output_dir=args.output,
        lang=args.lang,
        dry_run=args.dry_run,
        delay=args.delay,
    )
