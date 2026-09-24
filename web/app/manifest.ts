import type { MetadataRoute } from "next";

/**
 * PWA manifest. `start_url` points at the Settings app rather than the landing
 * page: once AuralAI is installed the user wants their devices, not marketing.
 * The landing page stays reachable in a normal browser tab.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "AuralAI — Melihat dengan Suara",
    short_name: "AuralAI",
    description:
      "Atur perangkat AuralAI dan coba simulasi kamera langsung dari ponsel — bisa dipakai offline.",
    lang: "id",
    dir: "ltr",
    start_url: "/app",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#F7F6F1",
    theme_color: "#00635D",
    categories: ["utilities", "medical", "productivity"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-maskable-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      {
        name: "Simulasi kamera",
        short_name: "Simulasi",
        description: "Coba cara kerja AuralAI dengan kamera ponsel.",
        url: "/simulasi",
        icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }],
      },
      {
        name: "Perangkat saya",
        short_name: "Perangkat",
        description: "Status dan pengaturan perangkat AuralAI.",
        url: "/app",
        icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }],
      },
    ],
  };
}
