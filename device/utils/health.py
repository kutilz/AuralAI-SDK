"""
System health reader — baca metrik hardware dari /proc dan /sys.
Tidak butuh dependency eksternal, berjalan di MaixCAM Linux.
"""

import os


def _read(path, default=""):
    try:
        with open(path) as f:
            return f.read().strip()
    except Exception:
        return default


def _thermals():
    temps = {}
    base = "/sys/class/thermal"
    if not os.path.isdir(base):
        return temps
    for entry in sorted(os.listdir(base)):
        if not entry.startswith("thermal_zone"):
            continue
        temp_path = os.path.join(base, entry, "temp")
        type_path = os.path.join(base, entry, "type")
        raw = _read(temp_path)
        if raw:
            zone_type = _read(type_path) or entry
            try:
                temps[zone_type] = round(int(raw) / 1000, 1)
            except ValueError:
                pass
    return temps


def _meminfo():
    result = {}
    raw = _read("/proc/meminfo")
    for line in raw.splitlines():
        parts = line.split()
        if len(parts) >= 2:
            key = parts[0].rstrip(":")
            try:
                result[key] = int(parts[1])  # kB
            except ValueError:
                pass
    return result


def _loadavg():
    raw = _read("/proc/loadavg")
    try:
        parts = raw.split()
        return [float(parts[0]), float(parts[1]), float(parts[2])]
    except Exception:
        return [0.0, 0.0, 0.0]


def _uptime():
    raw = _read("/proc/uptime")
    try:
        return float(raw.split()[0])
    except Exception:
        return 0.0


def _cpu_freq_mhz():
    paths = [
        "/sys/devices/system/cpu/cpu0/cpufreq/scaling_cur_freq",
        "/sys/devices/system/cpu/cpu0/cpufreq/cpuinfo_cur_freq",
    ]
    for p in paths:
        raw = _read(p)
        if raw:
            try:
                return int(raw) // 1000
            except ValueError:
                pass
    return 0


def _disk_free_mb(path="/"):
    try:
        s = os.statvfs(path)
        return (s.f_bavail * s.f_frsize) // (1024 * 1024)
    except Exception:
        return 0


def _disk_total_mb(path="/"):
    try:
        s = os.statvfs(path)
        return (s.f_blocks * s.f_frsize) // (1024 * 1024)
    except Exception:
        return 0


def get_health() -> dict:
    """Return dict berisi semua metrik hardware MaixCAM."""
    thermals = _thermals()
    mem = _meminfo()

    total_kb = mem.get("MemTotal", 0)
    avail_kb = mem.get("MemAvailable", mem.get("MemFree", 0))
    total_mb = total_kb // 1024
    avail_mb = avail_kb // 1024
    used_pct = round((1 - avail_mb / total_mb) * 100) if total_mb else 0

    disk_free  = _disk_free_mb()
    disk_total = _disk_total_mb()
    disk_pct   = round((1 - disk_free / disk_total) * 100) if disk_total else 0

    # Suhu tertinggi sebagai representasi utama
    cpu_temp = max(thermals.values()) if thermals else 0.0

    uptime_s = int(_uptime())
    h, rem   = divmod(uptime_s, 3600)
    m        = rem // 60

    return {
        "cpu_temp_c":    cpu_temp,
        "thermals":      thermals,
        "ram_total_mb":  total_mb,
        "ram_free_mb":   avail_mb,
        "ram_used_pct":  used_pct,
        "disk_free_mb":  disk_free,
        "disk_total_mb": disk_total,
        "disk_used_pct": disk_pct,
        "load_avg":      _loadavg(),
        "uptime_s":      uptime_s,
        "uptime_str":    f"{h}j {m:02d}m",
        "cpu_freq_mhz":  _cpu_freq_mhz(),
    }
