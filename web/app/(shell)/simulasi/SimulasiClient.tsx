"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import AppBar from "@/components/app/AppBar";
import Notice from "@/components/Notice";
import { SettingsField, SettingsGroup, SettingsItem } from "@/components/app/Settings";
import { INFERENCE_INTERVAL_MS, NAV_OBJECTS, caption } from "@/lib/sim/constants";
import { decide, type AnnounceState, type Detection } from "@/lib/sim/announce";
import { detectFrame, loadDetector } from "@/lib/sim/detector";
import { qrisPhrase, scanQr } from "@/lib/sim/qris";
import { SimAudio, type AudioMode } from "@/lib/sim/audio";
import { describeScene, loadKey, saveKey, type SimProvider } from "@/lib/sim/describe";
import type { Tier } from "@/lib/sim/vision";

type Mode = "penjelajah" | "qris";
type Status = "idle" | "starting" | "running" | "error";
type LogKind = "nav" | "near" | "system" | "ai" | "qris";
type LogItem = { id: number; at: string; text: string; kind: LogKind };

const LONG_PRESS_MS = 800;
const LOG_MAX = 40;

/** Fit the overlay canvas to how the browser actually crops the video (cover). */
function coverTransform(video: HTMLVideoElement, canvas: HTMLCanvasElement) {
  const vw = video.videoWidth || 1;
  const vh = video.videoHeight || 1;
  const scale = Math.max(canvas.width / vw, canvas.height / vh);
  return { scale, dx: (canvas.width - vw * scale) / 2, dy: (canvas.height - vh * scale) / 2 };
}

export default function SimulasiClient() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const overlayRef = useRef<HTMLCanvasElement | null>(null);
  const workRef = useRef<HTMLCanvasElement | null>(null); // offscreen, for QR pixels
  const streamRef = useRef<MediaStream | null>(null);
  const audioRef = useRef<SimAudio | null>(null);
  const rafRef = useRef<number | null>(null);
  const wakeRef = useRef<{ release: () => Promise<void> } | null>(null);
  // The frame loop re-enters through this ref, never through a captured
  // closure: `tick` is rebuilt whenever debug drawing changes, and a running
  // loop must pick that up instead of running the version it started with.
  const tickRef = useRef<() => void>(() => {});

  // Loop-owned state — refs, not React state, so the frame loop never restarts.
  const announceState = useRef<AnnounceState>({});
  const prevTiers = useRef<Map<string, Tier>>(new Map());
  const lastInference = useRef(0);
  const detectionsRef = useRef<Detection[]>([]);
  const forceRef = useRef(false);
  const modeRef = useRef<Mode>("penjelajah");
  const lastQr = useRef<{ value: string; at: number }>({ value: "", at: 0 });
  const busyRef = useRef(false);
  const runningRef = useRef(false);
  const logId = useRef(0);

  const [status, setStatus] = useState<Status>("idle");
  const [mode, setMode] = useState<Mode>("penjelajah");
  const [audioMode, setAudioMode] = useState<AudioMode>("both");
  const [log, setLog] = useState<LogItem[]>([]);
  const [err, setErr] = useState("");
  const [modelState, setModelState] = useState<"none" | "loading" | "ready" | "failed">("none");
  const [debug, setDebug] = useState(false);
  const [stats, setStats] = useState({ ms: 0, count: 0 });
  const [detections, setDetections] = useState<Detection[]>([]);
  const [holding, setHolding] = useState(false);
  const [describing, setDescribing] = useState(false);
  const [provider, setProvider] = useState<SimProvider>("openai");
  const [apiKey, setApiKey] = useState("");
  const [noIdVoice, setNoIdVoice] = useState(false);

  useEffect(() => {
    const stored = loadKey();
    setProvider(stored.provider);
    setApiKey(stored.key);
  }, []);

  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);

  const say = useCallback((text: string, kind: LogKind) => {
    const at = new Date().toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    setLog((prev) => [{ id: logId.current++, at, text, kind }, ...prev].slice(0, LOG_MAX));
  }, []);

  // ─── camera + loop ────────────────────────────────────────────────────────

  const stop = useCallback(() => {
    runningRef.current = false;
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    audioRef.current?.silence();
    wakeRef.current?.release().catch(() => {});
    wakeRef.current = null;
    announceState.current = {};
    prevTiers.current.clear();
    setStatus("idle");
  }, []);

  useEffect(() => () => stop(), [stop]);

  const drawOverlay = useCallback(() => {
    const video = videoRef.current;
    const canvas = overlayRef.current;
    if (!video || !canvas) return;
    const rect = canvas.getBoundingClientRect();
    if (canvas.width !== rect.width || canvas.height !== rect.height) {
      canvas.width = Math.round(rect.width);
      canvas.height = Math.round(rect.height);
    }
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // The 3×3 grid the position names come from — worth seeing while learning.
    ctx.strokeStyle = "rgba(255,255,255,.18)";
    ctx.lineWidth = 1;
    for (let i = 1; i < 3; i++) {
      ctx.beginPath();
      ctx.moveTo((canvas.width / 3) * i, 0);
      ctx.lineTo((canvas.width / 3) * i, canvas.height);
      ctx.moveTo(0, (canvas.height / 3) * i);
      ctx.lineTo(canvas.width, (canvas.height / 3) * i);
      ctx.stroke();
    }

    if (!debug) return;
    const { scale, dx, dy } = coverTransform(video, canvas);
    ctx.font = "600 13px system-ui, sans-serif";
    for (const d of detectionsRef.current) {
      const x = d.bbox.x * scale + dx;
      const y = d.bbox.y * scale + dy;
      const w = d.bbox.w * scale;
      const h = d.bbox.h * scale;
      const near = d.tier === "near";
      ctx.strokeStyle = near ? "#5FD3C6" : "#6B9BFF";
      ctx.lineWidth = near ? 3 : 2;
      ctx.strokeRect(x, y, w, h);
      const text = `${NAV_OBJECTS[d.label] ?? d.label} ${d.position} ${d.tier}`;
      const tw = ctx.measureText(text).width + 10;
      ctx.fillStyle = near ? "#5FD3C6" : "#6B9BFF";
      ctx.fillRect(x, Math.max(y - 20, 0), tw, 20);
      ctx.fillStyle = "#002D2A";
      ctx.fillText(text, x + 5, Math.max(y - 6, 14));
    }
  }, [debug]);

  const tick = useCallback(async () => {
    // Check before re-arming, so a stopped loop can never schedule another frame.
    if (!runningRef.current) return;
    rafRef.current = requestAnimationFrame(() => tickRef.current());
    const video = videoRef.current;
    const audio = audioRef.current;
    if (!video || !audio || video.readyState < 2) return;

    drawOverlay();

    const now = performance.now();
    const forced = forceRef.current;
    if (!forced && now - lastInference.current < INFERENCE_INTERVAL_MS) return;
    if (busyRef.current) return;
    busyRef.current = true;
    lastInference.current = now;

    try {
      if (modeRef.current === "qris") {
        // A short press in QRIS mode re-reads the last code instead of forcing
        // a scan; clearing the flag here also stops it pinning the loop at full
        // rate for every later frame.
        if (forced) {
          forceRef.current = false;
          if (lastQr.current.value) {
            const again = qrisPhrase(lastQr.current.value);
            audio.say(again, true);
            say(again, "qris");
          } else {
            const none = "Belum ada kode yang terbaca.";
            audio.say(none, true);
            say(none, "system");
          }
        }
        const work = workRef.current;
        if (work) {
          const w = 480;
          const h = Math.round((video.videoHeight / Math.max(video.videoWidth, 1)) * w) || 360;
          work.width = w;
          work.height = h;
          work.getContext("2d", { willReadFrequently: true })?.drawImage(video, 0, 0, w, h);
          const value = await scanQr(work);
          // De-dupe: the same code stays in frame for many seconds.
          if (value && (value !== lastQr.current.value || now - lastQr.current.at > 8000)) {
            lastQr.current = { value, at: now };
            const phrase = qrisPhrase(value);
            audio.say(phrase, true);
            say(phrase, "qris");
          }
        }
        return;
      }

      const model = await loadDetector();
      const started = performance.now();
      const dets = await detectFrame(
        model,
        video,
        video.videoWidth,
        video.videoHeight,
        prevTiers.current
      );
      const elapsed = Math.round(performance.now() - started);

      detectionsRef.current = dets;
      setDetections(dets);
      setStats({ ms: elapsed, count: dets.length });

      if (!runningRef.current) return;

      const { announcements, state } = decide(announceState.current, dets, now / 1000, forced);
      announceState.current = state;
      if (forced) forceRef.current = false;

      if (announcements.length === 0 && forced) {
        const phrase = "Tidak ada objek yang dikenali.";
        audio.say(phrase, true);
        say(phrase, "system");
      }
      for (const a of announcements) {
        audio.announce(a.label, a.position, a.tier, a.is_danger);
        say(caption(a.label, a.position, a.tier), a.tier === "near" ? "near" : "nav");
      }
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Terjadi kesalahan saat memproses frame.");
    } finally {
      busyRef.current = false;
    }
  }, [drawOverlay, say]);

  const start = useCallback(async () => {
    setErr("");
    setStatus("starting");
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error("Browser ini tidak mendukung akses kamera.");
      }

      const audio = audioRef.current ?? new SimAudio();
      audioRef.current = audio;
      await audio.unlock(); // must happen inside the tap that started us
      audio.setMode(audioMode);
      setNoIdVoice(!audio.hasIdVoice);

      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 } },
        audio: false,
      });
      streamRef.current = stream;
      const video = videoRef.current;
      if (!video) throw new Error("Pemutar video tidak siap.");
      video.srcObject = stream;
      await video.play();

      if (mode === "penjelajah" && modelState !== "ready") {
        setModelState("loading");
        try {
          await loadDetector();
          setModelState("ready");
        } catch {
          setModelState("failed");
          throw new Error(
            "Gagal memuat model deteksi. Butuh internet sekali di awal — setelah itu tersimpan dan bisa offline."
          );
        }
      }

      try {
        wakeRef.current = await (
          navigator as Navigator & { wakeLock?: { request: (t: "screen") => Promise<{ release: () => Promise<void> }> } }
        ).wakeLock?.request("screen");
      } catch {
        /* keeping the screen on is a nicety, not a requirement */
      }

      runningRef.current = true;
      setStatus("running");
      const hello = "AuralAI siap digunakan.";
      audio.say(hello, true);
      say(hello, "system");
      rafRef.current = requestAnimationFrame(() => tickRef.current());
    } catch (e: unknown) {
      const msg =
        e instanceof DOMException && (e.name === "NotAllowedError" || e.name === "SecurityError")
          ? "Akses kamera ditolak. Izinkan kamera di pengaturan browser, lalu coba lagi."
          : e instanceof DOMException && e.name === "NotFoundError"
            ? "Tidak ada kamera yang bisa dipakai di perangkat ini."
            : e instanceof Error
              ? e.message
              : "Gagal memulai simulasi.";
      setErr(msg);
      setStatus("error");
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
  }, [audioMode, mode, modelState, say]);

  useEffect(() => {
    tickRef.current = () => void tick();
  }, [tick]);

  // ─── the single physical button ───────────────────────────────────────────

  const pressTimer = useRef<number | null>(null);
  const longFired = useRef(false);

  const describe = useCallback(async () => {
    const video = videoRef.current;
    const audio = audioRef.current;
    if (!video || !audio) return;
    if (!apiKey.trim()) {
      const msg = "Belum ada API key. Isi di bagian Jelaskan sekitar di bawah.";
      audio.say(msg, true);
      say(msg, "system");
      return;
    }
    setDescribing(true);
    audio.say("Sedang memproses.", true);
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 20_000);
    try {
      const text = await describeScene(video, provider, apiKey.trim(), controller.signal);
      audio.say(text, true);
      say(text, "ai");
    } catch (e: unknown) {
      const msg =
        e instanceof DOMException && e.name === "AbortError"
          ? "Terlalu lama menunggu jawaban. Coba lagi."
          : e instanceof Error
            ? e.message
            : "Gagal menjelaskan sekitar.";
      audio.say("Gagal, coba lagi.", true);
      say(msg, "system");
    } finally {
      window.clearTimeout(timeout);
      setDescribing(false);
    }
  }, [apiKey, provider, say]);

  const onPressStart = () => {
    if (status !== "running") return;
    longFired.current = false;
    setHolding(true);
    pressTimer.current = window.setTimeout(() => {
      longFired.current = true;
      setHolding(false);
      navigator.vibrate?.(30);
      void describe();
    }, LONG_PRESS_MS);
  };

  /** @param commit false when the pointer slid off or was cancelled. */
  const onPressEnd = (commit: boolean) => {
    if (pressTimer.current !== null) window.clearTimeout(pressTimer.current);
    pressTimer.current = null;
    setHolding(false);
    if (!commit || status !== "running" || longFired.current) return;
    navigator.vibrate?.(15);
    // Short press = read the scene out now, bypassing cooldown and cap.
    forceRef.current = true;
  };

  // ─── settings side-effects ────────────────────────────────────────────────

  useEffect(() => {
    audioRef.current?.setMode(audioMode);
  }, [audioMode]);

  useEffect(() => {
    if (status !== "running") return;
    // Switching modes clears what the old mode remembered.
    announceState.current = {};
    prevTiers.current.clear();
    detectionsRef.current = [];
    setDetections([]);
    audioRef.current?.silence();
  }, [mode, status]);

  const running = status === "running";

  return (
    <>
      <AppBar
        title="Simulasi kamera"
        back="/app"
        trailing={
          <span className={`pill ${running ? "pill--ok" : "pill--off"}`}>
            {running ? (mode === "qris" ? "Mode QRIS" : "Mode penjelajah") : "Berhenti"}
          </span>
        }
      />

      <div className="app-body">
        {err && <Notice kind="err">{err}</Notice>}
        {running && noIdVoice && (
          <Notice kind="warn">
            Ponselmu belum punya suara Bahasa Indonesia, jadi pengucapannya akan terdengar
            aneh. Pasang paket suara Indonesia di pengaturan Text-to-speech.
          </Notice>
        )}

        <div className="sim-stage">
          {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
          <video ref={videoRef} playsInline muted aria-hidden="true" hidden={!running} />
          <canvas ref={overlayRef} aria-hidden="true" hidden={!running} />
          <canvas ref={workRef} hidden aria-hidden="true" />
          {!running && (
            <div className="sim-stage__idle">
              <p style={{ margin: 0, fontSize: "var(--t-md)", fontWeight: 700 }}>
                Arahkan kamera belakang ke sekitarmu
              </p>
              <p style={{ margin: "var(--s-3) 0 0", color: "#C9CEEA" }}>
                {modelState === "loading"
                  ? "Memuat model deteksi…"
                  : "Pakai earphone supaya arah kiri/kanan terdengar jelas."}
              </p>
            </div>
          )}
        </div>

        {!running ? (
          <button className="btn btn--primary btn--lg" onClick={start} disabled={status === "starting"}>
            {status === "starting" ? "Menyiapkan…" : "Mulai simulasi"}
          </button>
        ) : (
          <>
            <button
              className="sim-button"
              data-holding={holding}
              onPointerDown={onPressStart}
              onPointerUp={() => onPressEnd(true)}
              onPointerLeave={() => onPressEnd(false)}
              onPointerCancel={() => onPressEnd(false)}
              onContextMenu={(e) => e.preventDefault()}
              disabled={describing}
            >
              {describing
                ? "Sedang memproses…"
                : holding
                  ? "Tahan terus untuk menjelaskan…"
                  : "Tombol AuralAI — tekan sebentar: ulangi · tekan lama: jelaskan sekitar"}
            </button>
            <button className="btn" onClick={stop}>
              Hentikan simulasi
            </button>
          </>
        )}

        <SettingsGroup
          title="Cara kerja"
          note="Logika arah, jarak, dan kapan harus bersuara diambil apa adanya dari perangkat — bukan tiruan kasar."
        >
          <SettingsField>
            <div className="field">
              <label htmlFor="sim-mode">Mode</label>
              <select
                id="sim-mode"
                className="select"
                value={mode}
                onChange={(e) => setMode(e.target.value as Mode)}
              >
                <option value="penjelajah">Penjelajah — sebut objek & arahnya</option>
                <option value="qris">QRIS — baca kode pembayaran</option>
              </select>
            </div>
          </SettingsField>
          <SettingsField>
            <div className="field">
              <label htmlFor="sim-audio">Cara mendengar</label>
              <select
                id="sim-audio"
                className="select"
                value={audioMode}
                onChange={(e) => setAudioMode(e.target.value as AudioMode)}
              >
                <option value="both">Chime + bicara (default)</option>
                <option value="chime">Hanya chime (mahir)</option>
                <option value="speech">Hanya bicara (pemula)</option>
              </select>
            </div>
          </SettingsField>
        </SettingsGroup>

        <SettingsGroup
          title="Jelaskan sekitar"
          note="Key hanya disimpan di ponsel ini dan dikirim langsung ke penyedia AI — tidak pernah lewat server AuralAI."
        >
          <SettingsField>
            <div className="field">
              <label htmlFor="sim-prov">Layanan AI</label>
              <select
                id="sim-prov"
                className="select"
                value={provider}
                onChange={(e) => {
                  const p = e.target.value as SimProvider;
                  setProvider(p);
                  saveKey(p, apiKey);
                }}
              >
                <option value="openai">OpenAI</option>
                <option value="gemini">Google Gemini</option>
              </select>
            </div>
          </SettingsField>
          <SettingsField>
            <div className="field">
              <label htmlFor="sim-key">API key</label>
              <input
                id="sim-key"
                className="input"
                type="password"
                value={apiKey}
                autoComplete="off"
                placeholder={provider === "gemini" ? "AIza…" : "sk-…"}
                onChange={(e) => {
                  setApiKey(e.target.value);
                  saveKey(provider, e.target.value);
                }}
              />
              <span className="hint">Kosongkan untuk menghapusnya dari ponsel ini.</span>
            </div>
          </SettingsField>
        </SettingsGroup>

        <SettingsGroup title="Yang terdengar">
          {log.length === 0 ? (
            <SettingsItem label="Belum ada suara" sub="Mulai simulasi untuk melihat transkripnya." />
          ) : (
            <div style={{ padding: "var(--s-3)" }}>
              <ul className="sim-log" role="log" aria-live="off">
                {log.map((l) => (
                  <li key={l.id} data-kind={l.kind}>
                    <time>{l.at}</time>
                    <span>{l.text}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </SettingsGroup>

        <SettingsGroup
          title="Panel debug"
          note="Menyalakan kotak deteksi di kamera dan menampilkan angka yang dipakai untuk memutuskan."
        >
          <SettingsField>
            <label style={{ display: "flex", alignItems: "center", gap: "var(--s-3)", minHeight: 32 }}>
              <input type="checkbox" checked={debug} onChange={(e) => setDebug(e.target.checked)} />
              <span className="srow__label">Tampilkan detail teknis</span>
            </label>
          </SettingsField>
          {debug && (
            <SettingsField>
              <div className="sim-chips" style={{ marginBottom: "var(--s-3)" }}>
                <span className="sim-chip">inferensi {stats.ms} ms</span>
                <span className="sim-chip">objek {stats.count}</span>
                <span className="sim-chip">interval {INFERENCE_INTERVAL_MS} ms</span>
                <span className="sim-chip">model {modelState}</span>
              </div>
              <pre className="sim-debug">
                {detections.length === 0
                  ? "— tidak ada objek relevan dalam frame —"
                  : detections
                      .map(
                        (d) =>
                          `${d.label.padEnd(11)} ${d.position.padEnd(12)} ${d.tier.padEnd(5)}` +
                          ` conf=${d.confidence.toFixed(2)} area=${d.areaRatio.toFixed(4)}` +
                          `${d.is_danger ? " DANGER" : ""}`
                      )
                      .join("\n")}
              </pre>
            </SettingsField>
          )}
        </SettingsGroup>
      </div>
    </>
  );
}
