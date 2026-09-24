"use client";

/**
 * "Jelaskan sekitar" — the simulator's stand-in for the device's Context mode.
 *
 * The call goes straight from the phone to the AI provider with the user's own
 * key; nothing passes through the AuralAI servers, and the key is only ever kept
 * in this browser's localStorage. That mirrors the device, where the key lives
 * encrypted on the hardware and the relay never sees it.
 *
 * The prompt is a condensed version of the device's pack
 * (device/utils/scene_prompt.py) — same priority ladder and the same "every
 * object must carry a describing detail" rule, kept short on purpose. The
 * device's full pack is the authority; this is a simulation of it.
 */

export type SimProvider = "openai" | "gemini";

const PROMPT = [
  "Kamu adalah mata untuk pengguna tunanetra di Indonesia. Jawab dalam bahasa Indonesia lisan,",
  "maksimal dua kalimat, langsung ke isinya tanpa basa-basi.",
  "URUTAN PRIORITAS: kalau ada benda yang dipegang atau disodorkan ke kamera, sebut hanya benda itu",
  "beserta angka atau tulisan yang terbaca padanya. Kalau tidak ada, sebut bahaya atau hambatan lebih",
  "dulu, lalu orang, lalu isi ruangan.",
  "SETIAP BENDA WAJIB BERCIRI: untuk orang sebut warna dan jenis pakaian lalu barang yang dipegang;",
  "untuk benda lain sebut jenis, warna, lalu tulisan atau angka yang terbaca.",
  "Kalau satu ciri tidak pasti, turunkan ke kata yang pasti benar, jangan hapus bendanya.",
  "Sebut arah dengan kiri, depan, atau kanan. Jangan menebak yang tidak terlihat.",
].join(" ");

const MODELS: Record<SimProvider, string> = {
  // Matches device/config.py defaults where the browser can reach them directly.
  openai: "gpt-4o-mini",
  gemini: "gemini-1.5-flash",
};

/** Grab the current frame as a JPEG data URL, downscaled to keep the call cheap. */
export function frameToJpeg(video: HTMLVideoElement, maxWidth = 768): string {
  const scale = Math.min(1, maxWidth / (video.videoWidth || maxWidth));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round((video.videoWidth || maxWidth) * scale);
  canvas.height = Math.round((video.videoHeight || maxWidth) * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) return "";
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.72);
}

async function describeOpenAI(dataUrl: string, key: string, signal: AbortSignal): Promise<string> {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    signal,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: MODELS.openai,
      max_tokens: 200,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: PROMPT },
            { type: "image_url", image_url: { url: dataUrl, detail: "low" } },
          ],
        },
      ],
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error?.message || `OpenAI menolak permintaan (${res.status}).`);
  return data?.choices?.[0]?.message?.content?.trim() || "";
}

async function describeGemini(dataUrl: string, key: string, signal: AbortSignal): Promise<string> {
  const base64 = dataUrl.split(",")[1] || "";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODELS.gemini}:generateContent?key=${encodeURIComponent(key)}`;
  const res = await fetch(url, {
    method: "POST",
    signal,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [
        {
          parts: [{ text: PROMPT }, { inline_data: { mime_type: "image/jpeg", data: base64 } }],
        },
      ],
      generationConfig: { maxOutputTokens: 200 },
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error?.message || `Gemini menolak permintaan (${res.status}).`);
  return data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || "";
}

export async function describeScene(
  video: HTMLVideoElement,
  provider: SimProvider,
  key: string,
  signal: AbortSignal
): Promise<string> {
  const dataUrl = frameToJpeg(video);
  if (!dataUrl) throw new Error("Tidak bisa mengambil gambar dari kamera.");
  const text =
    provider === "gemini"
      ? await describeGemini(dataUrl, key, signal)
      : await describeOpenAI(dataUrl, key, signal);
  return text || "Tidak ada hasil yang bisa dibacakan.";
}

// ─── key storage (this browser only) ────────────────────────────────────────

const KEY_STORE = "auralai.sim.key";
const PROVIDER_STORE = "auralai.sim.provider";

export function loadKey(): { provider: SimProvider; key: string } {
  try {
    const provider = (localStorage.getItem(PROVIDER_STORE) as SimProvider) || "openai";
    return { provider, key: localStorage.getItem(KEY_STORE) || "" };
  } catch {
    return { provider: "openai", key: "" };
  }
}

export function saveKey(provider: SimProvider, key: string) {
  try {
    localStorage.setItem(PROVIDER_STORE, provider);
    if (key) localStorage.setItem(KEY_STORE, key);
    else localStorage.removeItem(KEY_STORE);
  } catch {
    /* private mode — the key simply won't be remembered */
  }
}
