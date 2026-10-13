"""Write a MaixCAM image to an SD card from Windows, then verify it.

    python flash_sd.py --list                       # show candidate cards
    python flash_sd.py <image.img> <disk-number>    # flash + verify (ADMIN)

Safety guards: refuses the system/boot disk, anything not on a USB/SD/MMC bus,
and anything outside 4-256 GB. Every volume on the card is locked +
dismounted (removable media cannot be set Offline) and the lock is held through
write AND readback, so Windows cannot mount and dirty the FAT /boot partition
in between; that makes a full byte-for-byte verification possible. Re-check the disk number every time - it changes.
"""
import ctypes
import hashlib
import json
import os
import subprocess
import sys
import time
from ctypes import wintypes

CHUNK = 4 * 1024 * 1024
GB = 1024 ** 3

GENERIC_READ, GENERIC_WRITE = 0x80000000, 0x40000000
FILE_SHARE_RW = 0x1 | 0x2
OPEN_EXISTING = 3
FILE_FLAG_WRITE_THROUGH = 0x80000000
INVALID = ctypes.c_void_p(-1).value

k32 = ctypes.WinDLL("kernel32", use_last_error=True)
k32.CreateFileW.restype = wintypes.HANDLE
k32.CreateFileW.argtypes = [wintypes.LPCWSTR, wintypes.DWORD, wintypes.DWORD,
                            ctypes.c_void_p, wintypes.DWORD, wintypes.DWORD,
                            wintypes.HANDLE]


def ps(cmd):
    r = subprocess.run(["powershell", "-NoProfile", "-Command", cmd],
                       capture_output=True, text=True)
    if r.returncode != 0:
        raise RuntimeError(r.stderr.strip() or cmd)
    return r.stdout.strip()


def disks():
    out = ps("Get-Disk | Select-Object Number,FriendlyName,BusType,Size,"
             "IsSystem,IsBoot,IsOffline,PartitionStyle | ConvertTo-Json")
    d = json.loads(out) if out else []
    return d if isinstance(d, list) else [d]


def candidate(d):
    return (d["BusType"] in ("USB", "SD", "MMC") and not d["IsSystem"]
            and not d["IsBoot"] and 4 * GB <= d["Size"] <= 256 * GB)


def show():
    for d in disks():
        tag = "  <- kandidat SD" if candidate(d) else ""
        print("  disk %-2s %-32s %-5s %6.1f GB%s" % (
            d["Number"], d["FriendlyName"][:32], d["BusType"],
            d["Size"] / GB, tag))


def open_disk(n, access):
    h = k32.CreateFileW(r"\\.\PhysicalDrive%d" % n, access, FILE_SHARE_RW,
                        None, OPEN_EXISTING, FILE_FLAG_WRITE_THROUGH, None)
    if h == INVALID or h is None:
        raise OSError("open PhysicalDrive%d failed, err=%d (jalankan sebagai "
                      "Administrator)" % (n, ctypes.get_last_error()))
    return h


FSCTL_LOCK_VOLUME, FSCTL_DISMOUNT_VOLUME = 0x90018, 0x90020


def lock_volumes(n):
    """Lock + dismount every lettered volume on disk n. Removable cards cannot
    be set Offline, and Windows refuses raw writes over a mounted volume. The
    handles stay open (lock held) until write AND verify are finished, so
    Windows cannot remount and dirty the new FAT /boot in between."""
    letters = ps("(Get-Partition -DiskNumber %d | Where-Object DriveLetter)"
                 ".DriveLetter -join ''" % n)
    hs = []
    for L in letters:
        h = k32.CreateFileW(r"\\.\%s:" % L, GENERIC_READ | GENERIC_WRITE,
                            FILE_SHARE_RW, None, OPEN_EXISTING, 0, None)
        if h == INVALID or h is None:
            raise OSError("open volume %s: failed err=%d" % (L, ctypes.get_last_error()))
        r = wintypes.DWORD()
        for code, what in ((FSCTL_LOCK_VOLUME, "lock"), (FSCTL_DISMOUNT_VOLUME, "dismount")):
            if not k32.DeviceIoControl(h, code, None, 0, None, 0, ctypes.byref(r), None):
                raise OSError("%s %s: failed err=%d (file di kartu masih terbuka?)"
                              % (what, L, ctypes.get_last_error()))
        print("  volume %s: locked + dismounted" % L)
        hs.append(h)
    return hs


def io(h, buf, write):
    n = wintypes.DWORD()
    fn = k32.WriteFile if write else k32.ReadFile
    if not fn(h, buf, len(buf), ctypes.byref(n), None):
        raise OSError("%s failed, err=%d" % ("write" if write else "read",
                                             ctypes.get_last_error()))
    return n.value


def flash(img, n):
    size = os.path.getsize(img)
    if size % 512:
        sys.exit("image size is not a multiple of 512")
    d = next((x for x in disks() if x["Number"] == n), None)
    if d is None:
        sys.exit("disk %d tidak ada" % n)
    if not candidate(d):
        sys.exit("TOLAK: disk %d (%s, %s, %.1f GB) bukan kartu SD yang aman"
                 % (n, d["FriendlyName"], d["BusType"], d["Size"] / GB))
    if d["Size"] < size:
        sys.exit("kartu lebih kecil dari image")
    print("Target: disk %d  %s  %.1f GB" % (n, d["FriendlyName"], d["Size"] / GB))

    vols = lock_volumes(n)
    src_md5 = hashlib.md5()
    t0 = time.time()
    try:
        h = open_disk(n, GENERIC_READ | GENERIC_WRITE)
        try:
            with open(img, "rb") as f:
                done = 0
                while True:
                    buf = f.read(CHUNK)
                    if not buf:
                        break
                    src_md5.update(buf)
                    io(h, buf, True)
                    done += len(buf)
                    print("\r  tulis  %5.1f%%" % (100 * done / size), end="")
            k32.FlushFileBuffers(h)
        finally:
            k32.CloseHandle(h)
        print("  (%.0fs)" % (time.time() - t0))

        h = open_disk(n, GENERIC_READ)
        try:
            k32.SetFilePointerEx(h, ctypes.c_longlong(0), None, 0)
            rb = hashlib.md5()
            left = size
            buf = ctypes.create_string_buffer(CHUNK)
            while left:
                want = min(CHUNK, left)
                got = io(h, (ctypes.c_char * want).from_buffer(buf), False)
                rb.update(buf.raw[:got])
                left -= got
                print("\r  verify %5.1f%%" % (100 * (size - left) / size), end="")
        finally:
            k32.CloseHandle(h)
        print()
    finally:
        for h in vols:
            k32.CloseHandle(h)
        ps("Update-Disk -Number %d" % n)

    if rb.hexdigest() != src_md5.hexdigest():
        sys.exit("VERIFY GAGAL: %s != %s" % (rb.hexdigest(), src_md5.hexdigest()))
    print("OK  md5 %s  (%.0fs total) - kartu siap, boleh dicabut."
          % (src_md5.hexdigest(), time.time() - t0))


if __name__ == "__main__":
    if len(sys.argv) == 2 and sys.argv[1] == "--list":
        show()
    elif len(sys.argv) == 3:
        flash(sys.argv[1], int(sys.argv[2]))
    else:
        print(__doc__)
        sys.exit(2)
