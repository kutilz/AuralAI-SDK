import type { Metadata, Viewport } from "next";
import { Plus_Jakarta_Sans, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import PwaBoot from "@/components/PwaBoot";

const sans = Plus_Jakarta_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-jakarta",
  display: "swap",
});

const mono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "700"],
  variable: "--font-jetbrains",
  display: "swap",
});

export const metadata: Metadata = {
  title: "AuralAI — Melihat dengan Suara",
  description:
    "Atur perangkat AuralAI dari ponsel dan coba simulasinya dengan kamera HP — pasang sebagai aplikasi, bisa dipakai offline.",
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000"),
  manifest: "/manifest.webmanifest",
  applicationName: "AuralAI",
  appleWebApp: {
    capable: true,
    title: "AuralAI",
    statusBarStyle: "default",
  },
  icons: {
    icon: [
      { url: "/icons/icon.svg", type: "image/svg+xml" },
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
    ],
    apple: "/icons/apple-touch-icon.png",
  },
};

export const viewport: Viewport = {
  themeColor: "#00635D",
  // The simulator draws a full-bleed camera view; let it reach the edges.
  viewportFit: "cover",
};

/**
 * Root shell only. The public site (Nav + Footer) and the installed app shell
 * are separate route groups — app/(marketing) and app/(app) — because the
 * marketing chrome is noise once AuralAI is running as a standalone PWA.
 */
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="id" className={`${sans.variable} ${mono.variable}`}>
      <body>
        <PwaBoot />
        {children}
      </body>
    </html>
  );
}
