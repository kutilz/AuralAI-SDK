"use client";

/**
 * The simulator's ears-only output, standing in for the device's AudioManager.
 *
 * Two channels, same as the hardware:
 *   chime  — a short panned blip. On the device these are pre-rendered WAVs so
 *            they play instantly and offline; here they're synthesised, which
 *            gets the same property for free and costs no download.
 *   speech — the Indonesian caption, via the phone's own TTS. The device uses
 *            cached gTTS audio; the words are identical (see constants.caption).
 *
 * Direction is carried by stereo panning, which is why the on-device chime is
 * worth hearing on earbuds: "orang di sebelah kiri" also *sounds* left.
 */

import { POS_KEY, caption } from "./constants";

export type AudioMode = "both" | "chime" | "speech";

/** Pan position per grid cell, −1 (hard left) … +1 (hard right). */
const PAN: Record<string, number> = {
  left: -0.85,
  right: 0.85,
  center: 0,
  top: 0,
  bottom: 0,
  top_left: -0.7,
  bottom_left: -0.7,
  top_right: 0.7,
  bottom_right: 0.7,
};

/** A distinct base pitch per object class so chimes stay tellable apart. */
const PITCH: Record<string, number> = {
  person: 660,
  motorcycle: 392,
  car: 330,
  bicycle: 494,
  bus: 294,
  truck: 262,
  dog: 587,
  cat: 740,
  chair: 523,
  bottle: 880,
  handbag: 784,
  backpack: 698,
};

export class SimAudio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  mode: AudioMode = "both";
  /** False when the phone has no Indonesian voice installed. */
  hasIdVoice = false;
  private voice: SpeechSynthesisVoice | null = null;
  private voiceHooked = false;
  /** Pending "speak after the chime" timers, so silence() can drop them. */
  private timers = new Set<number>();

  /** Must run inside a user gesture — mobile browsers start audio suspended. */
  async unlock(): Promise<void> {
    if (!this.ctx) {
      const Ctor =
        window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new Ctor();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.5;
      this.master.connect(this.ctx.destination);
    }
    if (this.ctx.state === "suspended") await this.ctx.resume();
    this.loadVoice();
    // Chrome fills the voice list asynchronously; hook it once, not per start.
    if (!this.voiceHooked && typeof speechSynthesis !== "undefined") {
      speechSynthesis.addEventListener?.("voiceschanged", () => this.loadVoice());
      this.voiceHooked = true;
    }
  }

  private loadVoice() {
    if (typeof speechSynthesis === "undefined") return;
    const voices = speechSynthesis.getVoices();
    const id = voices.find((v) => v.lang?.toLowerCase().startsWith("id"));
    this.voice = id ?? null;
    this.hasIdVoice = !!id;
  }

  setMode(mode: AudioMode) {
    this.mode = mode;
  }

  setVolume(v: number) {
    if (this.master) this.master.gain.value = Math.min(Math.max(v, 0), 1);
  }

  /** One panned blip. `urgent` doubles it and lifts the pitch. */
  private blip(label: string, posKey: string, urgent: boolean) {
    const ctx = this.ctx;
    const master = this.master;
    if (!ctx || !master) return;

    const base = (PITCH[label] ?? 520) * (urgent ? 1.5 : 1);
    const pan = PAN[posKey] ?? 0;
    const now = ctx.currentTime;
    const beats = urgent ? [0, 0.18] : [0];

    for (const offset of beats) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const panner = ctx.createStereoPanner?.();

      osc.type = "sine";
      osc.frequency.setValueAtTime(base, now + offset);
      // A small downward sweep reads as "a thing", not as an alarm.
      osc.frequency.exponentialRampToValueAtTime(base * 0.82, now + offset + 0.13);

      gain.gain.setValueAtTime(0.0001, now + offset);
      gain.gain.exponentialRampToValueAtTime(0.6, now + offset + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + offset + 0.15);

      osc.connect(gain);
      if (panner) {
        panner.pan.value = pan;
        gain.connect(panner);
        panner.connect(master);
      } else {
        gain.connect(master); // Safari <14.1 has no StereoPanner
      }
      osc.start(now + offset);
      osc.stop(now + offset + 0.18);
    }
  }

  /** Speak one line. `urgent` barges in, like the device's CRITICAL priority. */
  say(text: string, urgent = false) {
    if (typeof speechSynthesis === "undefined" || !text) return;
    if (urgent) speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = "id-ID";
    if (this.voice) u.voice = this.voice;
    u.rate = 1.05;
    u.pitch = 1;
    speechSynthesis.speak(u);
  }

  /**
   * One nav announcement: chime and/or caption, depending on the audio mode.
   * Returns the caption so the caller can show it in the transcript.
   */
  announce(label: string, cell: string, tier: string, danger: boolean): string {
    const posKey = POS_KEY[cell] ?? cell;
    const text = caption(label, cell, tier);
    const urgent = danger || tier === "near";
    if (this.mode !== "speech") this.blip(label, posKey, urgent);
    if (this.mode !== "chime") {
      // Let the chime land first so the two don't overlap into mush.
      const id = window.setTimeout(() => {
        this.timers.delete(id);
        this.say(text, urgent);
      }, this.mode === "both" ? 220 : 0);
      this.timers.add(id);
    }
    return text;
  }

  /** Cancel anything still queued (mode switch, stop button). */
  silence() {
    this.timers.forEach((id) => window.clearTimeout(id));
    this.timers.clear();
    if (typeof speechSynthesis !== "undefined") speechSynthesis.cancel();
  }

  close() {
    this.silence();
    try {
      this.ctx?.close();
    } catch {
      /* already closed */
    }
    this.ctx = null;
    this.master = null;
  }
}
