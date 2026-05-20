# Audit Keamanan Sistem: Hardware & Software - AuralAI SDK

## 1. Keamanan Jaringan & Web Server

### Kerentanan Utama: Tidak Ada Autentikasi

- **Lokasi:** `device/server/web_server.py`
- **Temuan:** Seluruh endpoint API (`/config`, `/command`, `/ai-settings`, `/suite/start`) terbuka secara publik tanpa memerlukan login atau token. 
- **Risiko:** 
  - Penyerang di jaringan yang sama dapat mengontrol perangkat sepenuhnya.
  - Pengubahan konfigurasi API Key (`POST /ai-settings`) dapat mencuri kredit cloud (OpenAI/Gemini/Claude) milik pengguna.
  - Remote Code Execution (RCE) potensial melalui trigger benchmark yang menjalankan subprocess.

### Keamanan Data (CORS)

- **Temuan:** Header `Access-Control-Allow-Origin: *` diaktifkan untuk semua response.
- **Risiko:** Cross-Site Request Forgery (CSRF). Website berbahaya yang dikunjungi oleh pengguna di browser yang sama dapat mengirimkan request ke IP lokal MaixCAM dan mengubah setting tanpa sepengetahuan pengguna.

---

## 2. Keamanan Sistem Operasi (Software)

### Eksekusi Subprocess & Shell

- **Lokasi:** `device/server/web_server.py` (BenchmarkRunner, StressRunner, BenchmarkSuiteRunner).
- **Temuan:** Penggunaan `subprocess.Popen` untuk menjalankan script Python. Meskipun argumen saat ini terlihat statis, tidak adanya autentikasi pada endpoint pemanggil membuatnya berbahaya.
- **Lokasi Lain:** `device/core/audio_manager.py` menggunakan `os.system()` untuk konversi audio via FFmpeg.
- **Risiko:** Jika input nama file audio dapat dikontrol oleh pengguna (melalui prompt injection atau config), penyerang dapat menyuntikkan perintah shell (Command Injection).

### Manajemen File & Kredensial

- **Lokasi:** `/root/config.json`
- **Temuan:** Kredensial (API Keys) disimpan dalam format teks polos (plain text) di dalam file JSON. 
- **Risiko:** Siapapun dengan akses fisik atau akses shell ke perangkat dapat membaca API Key tersebut.

---

## 3. Keamanan Hardware & Fisik

### Akses GPIO

- **Lokasi:** `device/core/orchestrator.py`
- **Temuan:** Perangkat mendengarkan input dari tombol fisik (`button_pin_mode`). 
- **Analisis:** Secara desain, ini adalah fitur. Namun, jika PIN GPIO terekspos secara fisik, "tombol" ini bisa dipicu secara elektrik untuk mengubah mode perangkat ke mode yang tidak diinginkan.

### Manajemen Termal & Stabilitas

- **Lokasi:** `device/utils/health.py` dan `device/core/watchdog.py`
- **Temuan:** Sudah terdapat `HealthMonitor` yang memantau suhu (throttle pada 80°C) dan `Watchdog` yang me-restart komponen jika hang.
- **Kualitas:** Sangat Baik. Ini mencegah kerusakan hardware akibat panas berlebih (thermal damage) saat menjalankan model AI yang berat.

### I2C Probing

- **Lokasi:** `device/utils/health.py`
- **Temuan:** Probing baterai dilakukan dengan menulis langsung ke bus I2C (`/dev/i2c-1` & `/dev/i2c-2`).
- **Risiko:** Jika terdapat device I2C lain yang sensitif pada alamat yang sama (0x36, 0x40), penulisan random saat probing dapat menyebabkan device tersebut masuk ke state yang tidak terdefinisi (glitch).

---

## 4. Ringkasan Risiko

| Kategori              | Level Risiko | Dampak                                      |
|:--------------------- |:------------ |:------------------------------------------- |
| **Autentikasi API**   | Kritis       | Kontrol penuh perangkat oleh pihak luar.    |
| **Pencurian API Key** | Tinggi       | Kerugian finansial pada akun Cloud AI.      |
| **Command Injection** | Sedang       | Potensi pengambilalihan shell OS.           |
| **Thermal Safety**    | Rendah       | Sudah tertangani dengan baik oleh software. |

---

## 5. Rekomendasi Perbaikan

1. **Implementasi API Key/Token:** Tambahkan layer autentikasi sederhana (misal: `X-API-KEY` header) untuk semua request POST ke perangkat.
2. **Bind ke Localhost (Jika Memungkinkan):** Jika dashboard hanya diakses via proxy atau tunnel, jangan bind web server ke `0.0.0.0`.
3. **Sanitasi Input Subprocess:** Pastikan semua argumen yang dikirim ke `subprocess` atau `os.system` dibersihkan dari karakter shell (`;`, `&`, `|`, `$`).
4. **Enkripsi Config:** Enkripsi API Key sebelum disimpan ke `config.json` menggunakan kunci unik perangkat (misal: ID dari CPU).
5. **Restriksi CORS:** Jangan gunakan wildcard `*`. Batasi hanya ke domain companion app yang dipercaya.

---

*Laporan ini dihasilkan secara otomatis untuk audit keamanan AuralAI-SDK.*
