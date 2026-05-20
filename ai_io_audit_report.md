# Audit Report: AI Input/Output System - AuralAI SDK

## 1. Ringkasan Arsitektur AI

Sistem AI dalam repo ini terbagi menjadi dua bagian utama:

- **Local AI (NPU):** Menggunakan YOLOv11 (via `maix.nn`) untuk deteksi objek real-time (person, car, etc.) di `device/core/ai_engine.py`.
- **Cloud AI (Vision):** Menggunakan provider eksternal (OpenAI, Gemini, Claude) untuk tugas yang lebih kompleks seperti deskripsi scene dan pemindaian QRIS.

## 2. Analisis Input (Prompt Construction & Injection)

### Prompt Construction

- **Lokasi:** `device/config.py` dan `device/config.json`.
- **Mekanisme:** Prompt didefinisikan sebagai string statis yang dapat diedit melalui API/Web Dashboard. Tidak ada logika konstruksi prompt yang kompleks (seperti template engine atau dynamic context injection) sebelum dikirim ke adapter.
- **Temuan:** Prompt sangat dasar. Contoh untuk QRIS:
  
  > "Baca kode QRIS ini. Sebutkan: nama merchant dan nominal jika ada. Format: MERCHANT: [nama], NOMINAL: [angka]. Jika bukan QRIS, jawab: BUKAN QRIS."

### Prompt Injection Risk

- **Kerentanan:** Tinggi (Internal Network).
- **Detail:** Karena endpoint `POST /ai-settings` di `device/server/web_server.py` tidak memiliki autentikasi, siapapun di jaringan yang sama dapat mengubah prompt sistem.
- **Dampak:** Penyerang dapat menyuntikkan instruksi ke prompt sistem untuk memaksa AI memberikan informasi palsu atau berbahaya kepada pengguna tunanetra (misalnya, memalsukan nominal QRIS atau menyembunyikan bahaya dalam deskripsi scene).

## 3. Analisis Output (Parsing & Validation)

### Output Parsing

- **Mekanisme:** Tidak ada parsing formal pada output AI.
- **Lokasi:** `device/core/ai_engine.py` pada metode `trigger_scene_description` dan `trigger_qris_scan`.
- **Temuan:** Hasil dari AI Vision Adapter langsung dikirim ke `AudioManager` untuk diproses sebagai audio atau disimpan ke log (`qris_log.json`). Sistem mengasumsikan AI akan selalu mengikuti format yang diminta (misal: format `MERCHANT: ...`).

### Output Validation

- **Temuan:** Tidak ada validasi apakah output AI masuk akal atau sesuai format.
- **Risiko:** Jika AI memberikan output di luar dugaan (hallucination), sistem akan mencatatnya mentah-mentah ke log.

## 4. AI Hallucination & Fallback Handling

### Hallucination Fallback

- **Mekanisme:** Tidak ada deteksi halusinasi secara algoritmik.
- **Analisis:** Sistem sangat bergantung pada reliabilitas model vision (GPT-4o, Gemini 1.5, dll).
- **Fallback Audio (Unintentional):** Menariknya, `AudioManager` hanya memutar suara jika ada file `.wav` yang cocok dengan teks. Karena deskripsi AI bersifat dinamis, kemungkinan besar deskripsi tersebut **tidak akan pernah disuarakan** secara audio kecuali ada sistem TTS (Text-to-Speech) yang belum terimplementasi sepenuhnya atau file suara dihasilkan secara on-the-fly (tidak ditemukan di kode core).
- **Fallback Error:** Sudah ada penanganan error untuk kegagalan API (timeout, invalid key). Sistem akan memutar audio sistem seperti `gagal_menganalisis` atau `gagal_memindai`.

## 5. Komponen Utama (Audit File)

| Komponen      | File                       | Status Audit                                                                                                               |
|:------------- |:-------------------------- |:-------------------------------------------------------------------------------------------------------------------------- |
| **AI Engine** | `device/core/ai_engine.py` | Berfungsi sebagai orchestrator antara NPU dan Cloud. Logika pemisahan resource (release/reload model) sudah baik.          |
| **Adapters**  | `device/adapters/*.py`     | Implementasi bersih menggunakan `urllib.request`. Mendukung multiple provider dengan interface yang konsisten (`base.py`). |
| **Config**    | `device/config.py`         | Menyimpan default prompt. Perlu pengamanan lebih pada persistensi config jika digunakan di lingkungan publik.              |
| **Scraper**   | -                          | Tidak ditemukan scraper eksternal; sistem hanya melakukan "scraping" frame kamera internal.                                |

## 6. Rekomendasi Perbaikan

1. **Input Sanitization:** Meskipun prompt bersifat internal, tambahkan validasi panjang karakter dan filter karakter berbahaya pada input prompt di dashboard.
2. **Output Parsing (QRIS):** Gunakan regex atau parsing logic untuk mengekstrak data dari respons AI QRIS. Jika format tidak sesuai, lakukan retry atau minta AI mengulang (re-prompting).
3. **Authentication:** Tambahkan autentikasi sederhana (misal: Token atau Basic Auth) pada Web Dashboard untuk mencegah modifikasi prompt dan API Key oleh pihak yang tidak berwenang.
4. **TTS Integration:** Jika deskripsi scene ingin disuarakan, integrasikan engine TTS (seperti gTTS atau offline TTS yang ringan untuk MaixCAM) daripada mengandalkan file `.wav` statis.
5. **Hallucination Check:** Untuk QRIS, bandingkan hasil AI dengan library decoder QR lokal (jika memungkinkan secara performa) sebagai verifikasi sekunder.

---

*Laporan ini dihasilkan secara otomatis untuk audit repositori AuralAI-SDK.*
