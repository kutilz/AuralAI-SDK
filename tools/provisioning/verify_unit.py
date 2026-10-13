"""Post-boot check of a freshly flashed MaixCAM Lite unit.

    python verify_unit.py <host-or-ip>        # e.g. aural-1a2b.local / 10.x.x.1 (USB)

One SSH connection, read-only commands only (the box has 128 MB RAM; do not
hammer it). Give it ~90 s after power-on before running.
"""
import sys
import paramiko

CHECKS = [
    ("device_key (USB serial)", "cat /device_key"),
    ("hostname / wlan0", "hostname; ip -4 -o addr show wlan0 | awk '{print $4}'"),
    ("wifi", "wpa_cli -i wlan0 status | grep -E '^(ssid|wpa_state)='"),
    ("app pid", "cat /tmp/aural_main.pid; pidof python3"),
    ("4.5.1 userspace dipakai",
     "tr '\\0' '\\n' < /proc/$(cat /tmp/aural_main.pid)/environ | grep -E 'PYTHONPATH|LD_LIBRARY'"),
    ("launcher mati", "pidof launcher_daemon launcher || echo 'tidak jalan (OK)'"),
    ("suhu C", "awk '{print $1/1000}' /sys/class/thermal/thermal_zone0/temp"),
    ("RAM", "free -m | sed -n 2p"),
    ("brand/model/watchdog",
     "python3 -c \"import json;d=json.load(open('/root/config.json'));"
     "print({k:d.get(k) for k in ('brand','model_path','input_height','hw_watchdog_enabled')},"
     "'device_token' in d)\""),
    ("log: error/traceback", "grep -iE 'traceback|SIGSEGV|error' /tmp/aural_main.log | tail -n 12"),
    ("log: tail", "tail -n 15 /tmp/aural_main.log"),
    ("http :8080/status",
     "wget -qO- http://127.0.0.1:8080/status | head -c 400"),
]


def main(host):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect(host, username="root", password="root", timeout=15,
              banner_timeout=30, look_for_keys=False, allow_agent=False)
    try:
        for name, cmd in CHECKS:
            _, out, err = c.exec_command(cmd, timeout=20)
            text = (out.read() + err.read()).decode(errors="replace").strip()
            print("== %s\n%s" % (name, text))
    finally:
        c.close()


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    main(sys.argv[1])
