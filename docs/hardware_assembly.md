# AuralAI — Panduan Rakit Hardware

Panduan merakit satu unit AuralAI: **MaixCAM + speaker mini + tombol + power**.
Perangkat ini untuk **pengguna tunanetra**, jadi **layar sudah dilepas** — semua
interaksi lewat **suara (speaker)** dan **satu tombol**.

> **Baterai sengaja BELUM dipasang.** MaixCAM tidak bisa membaca kapasitas baterai
> tanpa modul fuel-gauge tambahan (lihat [§5](#5-baterai-ditunda)). Untuk sekarang,
> beri daya lewat **USB-C** saja.

---

## 1. Daftar komponen

| Komponen | Catatan |
|---|---|
| Sipeed MaixCAM (varian reguler) | Layar LCD sudah dilepas — tidak apa-apa, perangkat full-audio |
| Speaker mini 8Ω (≤2W) | Untuk output suara TTS + chime |
| Tombol push-button (momentary) | 1 tombol: ulang URL / ganti mode / acknowledge |
| Kabel USB-C + adaptor 5V (≥1A) | Sumber daya utama (pengganti baterai sementara) |
| Kabel jumper tipis / solder | Untuk speaker & tombol |

---

## 2. Power (USB-C 5V)

1. Colok **USB-C** dari adaptor 5V (atau power bank) ke port USB-C MaixCAM.
2. Perangkat langsung menyala — tidak ada tombol power terpisah yang wajib.
3. Setelah autostart aktif ([dokumen terpisah](#7-langkah-berikutnya)), MaixCAM
   otomatis menjalankan AuralAI saat dapat daya.

> Arus: pakai adaptor minimal **1A**. Saat kamera + NPU + WiFi aktif, konsumsi
> bisa naik; adaptor lemah bikin perangkat reboot sendiri.

---

## 3. Speaker mini

MaixCAM punya **amplifier audio onboard**. Speaker mini disambung ke **konektor /
pad speaker** di board:

1. Cari konektor speaker (`SPK`) atau pad **SPK+ / SPK-** di MaixCAM.
2. Sambungkan kabel speaker: **SPK+ → kabel merah**, **SPK- → kabel hitam**
   (polaritas speaker mini biasanya tidak kritis untuk suara mono).
3. Kalau speaker pakai konektor JST yang cocok, tinggal colok.

**Uji speaker:** setelah backend jalan, perangkat memutar chime objek (mis. saat
melihat orang/kursi). Kalau terdengar "orang di depan" dsb, speaker OK.

> Suara dinamis (deskripsi, baca QRIS, **pengumuman URL**) butuh paket **gTTS**
> ter-install di device — lihat [§6](#6-suara-dinamis-gtts).

---

## 4. Tombol (GPIO A26, active-low)

Satu tombol mengontrol semuanya. Berdasarkan pengujian board ini, pad **A26**
idle **HIGH** secara stabil, jadi kita pakai pola **active-low** (tekan = ke GND).
**Tidak perlu resistor eksternal.**

**Wiring:**

```
  Tombol kaki 1  ─────────  Pin A26 (MaixCAM)
  Tombol kaki 2  ─────────  GND     (MaixCAM)
```

- Saat dilepas: A26 = 1 (idle). Saat ditekan: A26 → GND = 0 (perangkat membaca "press").
- Pin sudah dikonfigurasi: `"button_pin_mode": "A26"` di `/root/config.json`.
  Mau ganti pin? Pakai pad lain yang idle-high, lalu set `button_pin_mode` ke nama
  pad-nya (mis. `"A26"`).

**Fungsi tombol:**

| Kondisi | Tekan sebentar | Tekan agak lama (≥1 dtk) |
|---|---|---|
| **Saat setup pertama** (URL belum di-acknowledge) | Ulangi pengumuman alamat web | "Sudah paham" → berhenti mengumumkan |
| **Pemakaian normal** (sudah di-setup) | Ganti mode (Jelajah → Deskripsi → QRIS) | **Ucapkan ulang alamat web** |

> Jadi pengguna/pendamping selalu bisa dengar alamat webnya lagi kapan saja:
> tekan tombol **agak lama**.

---

## 5. Baterai (ditunda)

MaixCAM **tidak meng-ekspose** data baterai (`/sys/class/power_supply` kosong —
sudah dicek di device ini). Artinya, untuk membaca **kapasitas/voltase** baterai
butuh **modul fuel-gauge I²C** tambahan, yang belum terpasang. Maka:

- **Sekarang:** jalankan dari USB-C, **konektor baterai dibiarkan kosong.**
- Backend sudah aman tanpa baterai: field `battery` di `/status` bernilai `null`
  dan tidak ada error (sudah diverifikasi).

**Nanti, kalau mau pakai baterai + bisa baca kapasitas:**

1. Pasang modul fuel-gauge I²C di bus I²C MaixCAM:
   - **INA219** (alamat `0x40`) — monitor arus + tegangan, atau
   - **MAX17043** (alamat `0x36`) — fuel gauge Li-Ion 1S.
2. Pakai sel **LiPo 1S** (3.7V nominal; aman 3.0–4.2V; stop ~3.3V under load).
3. Aktifkan pembacaan: `POST /i2c-probe` dari dashboard (atau set
   `i2c_battery_enabled: true`). Backend akan mulai mengisi `battery` di `/status`.

> Tanpa modul itu, jangan andalkan persentase baterai — pantau manual / pakai
> power bank dengan indikator sendiri.

---

## 6. Suara dinamis (gTTS)

Karena tidak ada layar, **suara adalah satu-satunya output**. Suara terbagi dua:

- **Chime objek** (118 file `.wav` siap pakai di `/root/audio`) — jalan offline.
- **Suara dinamis** (deskripsi scene, baca QRIS, **pengumuman alamat web**,
  "AuralAI siap") — disintesis via **gTTS** dan butuh internet sekali per kalimat
  (hasilnya di-cache di `/root/audio/tts_cache`).

**Install sekali per device** (butuh internet):

```bash
pip3 install -r /root/aural-ai/requirements_device.txt
# atau minimal:
pip3 install gtts
```

> Tanpa gTTS, semua kalimat dinamis akan **diam** (cuma chime objek yang bunyi).
> Ini wajib di-install supaya pengumuman URL & deskripsi berfungsi.

---

## 7. Cara tahu alamat web (tanpa layar)

Karena layar dilepas, alamat web ditemukan lewat **2 cara**:

1. **Nama tetap (mDNS):** perangkat tampil sebagai
   **`http://aural-bfe2.local:8080`** (nama unik dari MAC WiFi). Buka ini dari HP
   pendamping yang **satu WiFi**. Nama ini tetap walau IP DHCP berubah.
   - Untuk multi-device, tiap unit dapat nama beda otomatis (mis. `aural-1a2b`),
     jadi **5 perangkat tidak bentrok**. Bisa di-rename di wizard setup
     (mis. `dapur.local`, `kamar-budi.local`).
2. **Diucapkan speaker:** saat pertama nyala (dan setup belum selesai), perangkat
   **mengucapkan alamatnya** (IP + nama). Tekan tombol **sebentar** untuk ulang,
   **agak lama** untuk "sudah paham". Di pemakaian normal, tekan tombol **agak
   lama** kapan saja untuk dengar alamatnya lagi.

---

## 8. Langkah berikutnya

- **Autostart saat boot:** `python tools/run.py --host <ip> --autostart`
  (status: `--autostart-status`, batal: `--autostart-off`).
  > ⚙️ **Penting (device tanpa layar):** karena LCD dicopot, **launcher MaixApp
  > tidak bisa jalan**, jadi mekanisme `auto_start.txt` bawaan **tidak berfungsi**.
  > Tool ini otomatis pakai **`/etc/rc.local`** (dijalankan `/etc/init.d/S99local`
  > saat boot, setelah WiFi + avahi) — andal untuk app headless. Verifikasi: cabut-
  > colok, lalu cek `http://aural-bfe2.local:8080` hidup sendiri.
- **Setup pengguna baru:** buka `http://aural-bfe2.local:8080/setup`, isi WiFi +
  nama perangkat + API key AI, lalu "Selesai".
- **Catatan RAM (128 MB):** RAM ketat. Autostart lewat rc.local sengaja TIDAK
  menjalankan launcher GUI, jadi RAM-nya untuk app + kamera + YOLO. Hindari
  menjalankan proses berat lain bersamaan.
