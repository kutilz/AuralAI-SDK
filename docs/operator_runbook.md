# AuralAI — Operator Runbook (Draft Outline)

> Dokumen ini adalah **outline kasar** untuk panduan operator yang akan kamu tulis lengkap nanti.
> Setiap bagian berisi poin-poin yang perlu dikembangkan menjadi prosedur lengkap.

---

## 1. Apa itu AuralAI?

- Asisten visual on-device untuk pengguna tunanetra
- Hardware: Sipeed MaixCAM dengan speaker internal
- Tiga mode utama: Explorer (deteksi objek), Scene (deskripsi AI), QRIS (scan bayar)
- Operator = pendamping pilot; pengguna = user tunanetra
- Dashboard web (`http://<ip-device>:8080`) untuk operator — bukan untuk pengguna

---

## 2. Persiapan Sebelum Pakai

### 2.1 Checklist Sebelum Diserahkan ke User

- [ ] Device sudah terhubung ke WiFi jaringan user
- [ ] API key sudah di-set via dashboard
- [ ] Audio test: device memutar "AuralAI siap" saat boot
- [ ] Mode Explorer jalan: objek terdeteksi → suara keluar
- [ ] Volume speaker cukup keras di lingkungan user (test pakai dB meter atau perkiraan)
- [ ] Baterai/power supply sudah terpasang
- [ ] config.json sudah disimpan ke backup

### 2.2 Setup API Key

1. Buka dashboard → menu AI Settings
2. Pilih provider (OpenAI / Gemini / Claude)
3. Masukkan API key → klik Save
4. Klik "Test Connection" — harus muncul respons AI
5. Catat token autentikasi dashboard di catatan operator (jangan bagikan ke user)

---

## 3. Cara Boot Device

- Sambungkan power → device boot otomatis (~30 detik)
- Tanda siap: suara "AuralAI siap digunakan" dari speaker
- Jika tidak ada suara dalam 60 detik → cek bagian Troubleshoot

### Indikator Audio Status

| Suara yang Terdengar              | Artinya                            |
| --------------------------------- | ---------------------------------- |
| "AuralAI siap digunakan"          | Boot sukses, siap dipakai          |
| "Mode penjelajah aktif"           | Masuk Explorer Mode                |
| "Mode konteks aktif"              | Masuk Scene Mode                   |
| "Mode scan bayar aktif"           | Masuk QRIS Mode                    |
| "Sedang menganalisis"             | AI Vision sedang memproses         |
| "Masih memproses"                 | AI masih bekerja, harap tunggu     |
| "Koneksi gagal"                   | Internet tidak tersedia            |
| "Gagal menganalisis"              | AI tidak bisa memproses permintaan |
| "Baterai lemah"                   | Segera isi daya                    |
| "Perangkat terlalu panas"         | Butuh pendinginan, kurangi pemakaian |

---

## 4. Mode Operasi

### 4.1 Explorer Mode (default)

- Aktif saat boot
- Kamera mendeteksi objek secara realtime (YOLO)
- Objek berbahaya (dekat) → suara CRITICAL priority (interupsi audio lain)
- Objek biasa → suara HIGH priority

### 4.2 Scene Mode

- Tombol fisik atau perintah dashboard → pindah ke Scene
- User tekan tombol → AI Vision deskripsikan pemandangan dalam Bahasa Indonesia
- Butuh koneksi internet
- Respons ~3-8 detik (audio progress tiap 3 detik selama menunggu)

### 4.3 QRIS Mode

- Aktif saat user mau scan kode pembayaran
- Default hybrid: local decoder + AI cross-check
- Hasil: "MERCHANT: [nama], NOMINAL: [angka]"
- Jika nominal > 1 juta IDR → minta konfirmasi ulang (safety cap)

### 4.4 Ganti Mode

- Via tombol fisik (konfigurasi pin di dashboard → Hardware Settings)
- Via dashboard → tombol mode switch
- Mode berputar: Explorer → Scene → QRIS → Explorer

---

## 5. Web Dashboard

- URL: `http://<ip-maixcam>:8080`
- IP bisa dicek dari layar MaixCAM atau router
- Login dengan token (lihat `/root/config.json` key `device_token` untuk token awal)
- **Dashboard HANYA untuk operator/dev** — audio tetap via speaker device

### Fitur Dashboard

- **Camera preview** — live feed kamera
- **Status bar** — mode aktif, FPS, suhu CPU, RAM
- **Log stream** — real-time log dari device
- **AI Settings** — ganti provider, API key, prompt
- **Presets** — switch konfigurasi cepat (Explorer/Scene/QRIS preset)
- **Health** — metrik hardware (suhu, disk, RAM)
- **I2C Probe** — cek battery HAT (POST `/i2c-probe`)

---

## 6. Troubleshoot WiFi

| Gejala                    | Langkah                                                       |
| ------------------------- | ------------------------------------------------------------- |
| Tidak ada suara "siap"    | Cek power, tunggu 60 detik, reboot                            |
| Dashboard tidak bisa dibuka | Cek IP device, pastikan di WiFi yang sama                   |
| "Koneksi gagal"           | Cek WiFi password, cek sinyal, reboot router                  |
| IP berubah tiap reboot    | Set static IP di router (MAC reservation)                     |
| Butuh 4G backup           | Gunakan hotspot HP, sambungkan device ke SSID hotspot         |

---

## 7. Troubleshoot Audio Tidak Keluar

1. Cek volume di dashboard (AI Settings → Audio Volume, default 80)
2. Cek apakah mode aktif (log harus ada deteksi objek)
3. Cek log untuk error "Audio fallback" → berarti WAV tidak ditemukan
4. Regenerate audio files: `python tools/generate_audio.py --from-wordlist`
5. Deploy ulang: `python tools/deploy.py --audio-only`
6. Cek speaker fisik (test dengan file audio lain langsung di device)

---

## 8. Cara Baca Log

- Dari dashboard: menu Logs → real-time stream
- Di device: `/root/logs/aural_*.log` (rotasi otomatis 7 hari / 100MB)
- Format: `[TIMESTAMP] [LEVEL] [MODULE] message`
- TTS cache: `/root/audio/tts_cache/` — file WAV dari synthesis runtime

### Level Log

| Level | Arti                                        |
| ----- | ------------------------------------------- |
| OK    | Operasi berhasil                            |
| INFO  | Informasi normal                            |
| WARN  | Peringatan (masih berjalan)                 |
| ERROR | Gagal, perlu perhatian                      |
| FATAL | Crash — device mungkin restart              |

---

## 9. Cara Reset Device

### Soft Reset (restart aplikasi)

- Dashboard → tombol Restart Service
- Atau SSH: `systemctl restart aural-ai`

### Hard Reset (reboot device)

- Cabut-colok power (aman, watchdog akan recovery)
- Atau SSH: `reboot`

### Factory Reset Config

```bash
# Di device via SSH:
rm /root/config.json
reboot
# Config akan regenerate dari defaults
```

### Backup Config

```bash
# Di PC:
scp root@<ip-maixcam>:/root/config.json ./backup_config_$(date +%Y%m%d).json
```

---

## 10. Maintenance Rutin

| Frekuensi   | Tugas                                                         |
| ----------- | ------------------------------------------------------------- |
| Setiap hari | Cek dashboard log sebentar, pastikan tidak ada FATAL          |
| Mingguan    | Cek disk usage (`/root/logs/` dan `/root/audio/tts_cache/`)   |
| Per sprint  | Backup config.json dari semua device                          |
| Per event   | Pastikan WiFi stabil sebelum user pakai, test mode QRIS       |

> Log rotation sudah otomatis (7 hari / 100MB). TTS cache tidak ada batas otomatis — trim manual jika disk penuh.

---

## 11. Logbook Lapangan

Minta setiap operator catat di buku/form digital:

- Tanggal & waktu kejadian
- User ID (anonim: U1, U2, ...)
- Mode yang aktif
- Apa yang terjadi (suara yang terdengar / tidak terdengar)
- Tindakan yang diambil
- Apakah resolved

Data logbook ini untuk laporan IEEE post-pilot.

---

## 12. Kontak & Eskalasi

| Situasi                     | Tindakan                                            |
| --------------------------- | --------------------------------------------------- |
| Bug ringan                  | Catat di logbook, lanjutkan                         |
| Device tidak bisa dipakai   | Soft reset → hard reset → hubungi dev               |
| Data user bocor (foto/log)  | Matikan device, hubungi dev segera                  |
| User mengeluh info salah    | Catat detail, switch ke offline mode, hubungi dev   |

> **Dev contact:** [isi nama/kontak developer]
> **Repo:** `github.com/<username>/AuralAI-SDK`
