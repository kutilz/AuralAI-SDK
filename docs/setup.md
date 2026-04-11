# AuralAI SDK — Setup Guide

## Prasyarat

- Sipeed MaixCAM (regular) dengan MaixPy terbaru
- Python 3.10+ di laptop/PC
- MaixVision (untuk deploy dan monitor)
- Koneksi WiFi yang sama antara laptop dan MaixCAM

---

## 1. Setup PC (Laptop)

```bash
# Clone repo
git clone https://github.com/<username>/AuralAI-SDK.git
cd AuralAI-SDK

# Install dependencies PC
pip install -r requirements_pc.txt
```

---

## 2. Generate Audio Files

Jalankan sekali sebelum deploy (butuh internet untuk gTTS):

```bash
# Daftar lengkap dari audio/AuralAI_Audio_Wordlist.md (~137 file)
python tools/generate_audio.py --from-wordlist

# Pola lama (objek×posisi + system pendek)
python tools/generate_audio.py --legacy
```

File WAV akan tersimpan di folder `audio/`.

Untuk preview dulu tanpa generate:
```bash
python tools/generate_audio.py --dry-run --from-wordlist
```

---

## 3. Download Model

### Untuk `device/main.py` (orchestrator + YOLOv8)

1. Buka [MaixHub Model Zoo](https://maixhub.com/model/zoo/196)
2. Download **YOLO11n COCO 320×224** (format `.mud`)
3. Simpan sebagai `models/yolo11n.mud` dan sesuaikan `MODEL_PATH` di `device/config.py`

### Untuk `device/aural_maix.py` (stack MVP / YOLOv5)

Script mencoba memuat (berurutan):

- `/root/models/yolov5s_320x224_int8.cvimodel`
- `/root/models/yolov5s.mud`

Unduh model YOLOv5 COCO 320×224 yang kompatibel MaixPy dari MaixHub, lalu letakkan di salah satu path di atas di MaixCAM.

---

## 4. Setup MaixCAM

### 4a. Via MaixVision (Manual)

1. Buka MaixVision → Connect ke MaixCAM
2. Upload folder `device/` ke `/root/aural-ai/` via File Manager
3. Upload folder `audio/` ke `/root/audio/`
4. Upload model ke `/root/models/yolo11n.mud`

### 4b. Via Deploy Script (Otomatis)

Pastikan MaixCAM dan laptop di WiFi yang sama:

```bash
# Deploy semua (device + audio)
python tools/deploy.py

# Custom IP jika mDNS tidak jalan
python tools/deploy.py --host 192.168.1.100

# Preview saja
python tools/deploy.py --dry-run
```

---

## 5. Set API Key (Opsional — untuk Context Mode)

Di MaixCAM, buat file `/root/.env`:

```bash
# Di terminal MaixCAM atau via MaixVision terminal:
echo 'OPENAI_API_KEY=sk-...' > /root/.env
```

Di `device/main.py`, tambahkan sebelum import:
```python
from dotenv import load_dotenv
load_dotenv("/root/.env")
```

---

## 6. Jalankan AuralAI SDK

### Via MaixVision
1. Buka `device/main.py` di MaixVision
2. Klik **Run**

### Via SSH / Terminal MaixCAM
```bash
cd /root/aural-ai/
python main.py
```

---

## 7. Akses Web Dashboard

Buka browser di HP atau laptop:
```
http://maixcam.local:8080
```

Atau gunakan IP langsung jika mDNS tidak berfungsi:
```
http://192.168.1.XXX:8080
```

---

## 8. Companion PC — stack MVP (MaixCAM + PC)

Arsitektur ini memisahkan **inferensi ringan (YOLO di MaixCAM)** dan **OpenAI Vision / TTS di browser** pada **laptop** yang menjalankan Flask (`companion/webserver.py`). Pola ini selaras dengan dokumentasi MaixPy: HTTP memakai modul `requests` di perangkat.

### 8a. PC (laptop)

```bash
cd aural-ai-sdk
pip install -r requirements_pc.txt
cp companion/.env.example companion/.env    # Windows: copy companion\.env.example companion\.env
# Edit companion/.env — set OPENAI_API_KEY

python companion/webserver.py
```

Catat **IP LAN** yang ditampilkan di terminal (misalnya `192.168.1.78`).

### 8b. MaixCAM

Set environment **sebelum** menjalankan `aural_maix.py` (di MaixVision bisa lewat shell atau wrapper):

| Variabel | Contoh | Fungsi |
|----------|--------|--------|
| `AURAL_WIFI_SSID` | nama AP | Kosongkan jika sudah sambung lewat **Settings → WiFi** (disarankan kalau DHCP dari script macet) |
| `AURAL_WIFI_PASSWORD` | (password) | — |
| `AURAL_COMPANION_HOST` | IP laptop | Harus sama subnet dengan MaixCAM |
| `AURAL_COMPANION_PORT` | `5000` | Port Flask companion |

Jalankan di MaixCAM (path setelah deploy ke `/root/aural-ai/`):

```bash
cd /root/aural-ai/
export AURAL_COMPANION_HOST=192.168.x.x
python aural_maix.py
```

Dashboard observer: `http://<IP-PC>:5000` (buka dari HP / browser di jaringan yang sama).

### 8c. Uji tanpa MaixCAM (webcam PC)

Dengan `webserver.py` tetap berjalan:

```bash
python companion/run_desktop.py
```

### 8d. Uji jaringan MaixCAM → PC (isolasi)

Kalau MaixCAM sudah WiFi tapi `Network unreachable` / heartbeat gagal, **jangan pakai IP `127.0.0.1` atau IP WSL** (`10.207.x.x` sering adapter virtual — tidak terjangkau dari WiFi perangkat). Pakai **IPv4 adapter Wi‑Fi / Ethernet** PC (cek `ipconfig` di Windows, bagian *Wireless LAN adapter Wi-Fi*).

1. **PC** — server minimal (port default 8765, beda dari webserver 5000 agar tidak bentrok):

```bash
python companion/minimal_server.py
```

2. **MaixCAM** — set host ke IP Wi‑Fi PC yang sama subnet, lalu:

```bash
export AURAL_PROBE_HOST=192.168.x.x
export AURAL_PROBE_PORT=8765
python device/network_probe.py
```

Jika ini berhasil, jalankan lagi `companion/webserver.py` dan set `AURAL_COMPANION_HOST` ke **IP yang sama** dengan port `5000`. Pastikan firewall Windows mengizinkan inbound Python pada port tersebut.

---

## 9. Mockup Preview (Tanpa MaixCAM)

Untuk preview Web UI dashboard **on-device** di browser tanpa hardware:

1. Buka `device/server/static/index.html` langsung di browser
2. Dashboard akan berjalan dalam **MOCK MODE** — semua data disimulasikan
3. Audio menggunakan Web Speech API browser

---

## Troubleshooting

| Problem | Solusi |
|---------|--------|
| `maixcam.local` tidak bisa diakses | Gunakan IP address langsung |
| Model tidak ditemukan | Pastikan path di `config.py` sesuai |
| Audio tidak keluar | Cek folder `/root/audio/` berisi file WAV |
| Web UI tidak refresh | Cek firewall / port 8080 tidak diblokir |
| Inference lambat | Normal — MaixCAM ~85-120ms per frame |
| `[Errno 101] Network unreachable` ke IP PC | **Subnet harus sama** dengan MaixCAM (biasanya 3 oktet pertama sama, mis. keduanya `192.168.1.*`). `network_probe.py` sekarang menampilkan IP MaixCAM vs PC. Satukan router/hotspot; hindari guest WiFi / AP isolation. Firewall: izinkan TCP 5000/8765. |
