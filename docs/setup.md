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
python tools/generate_audio.py
```

File WAV akan tersimpan di folder `audio/`.

Untuk preview dulu tanpa generate:
```bash
python tools/generate_audio.py --dry-run
```

---

## 3. Download Model

1. Buka [MaixHub Model Zoo](https://maixhub.com/model/zoo/196)
2. Download **YOLO11n COCO 320×224** (format `.mud`)
3. Simpan sebagai `models/yolo11n.mud`

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

## 8. Mockup Preview (Tanpa MaixCAM)

Untuk preview Web UI di browser tanpa hardware:

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
