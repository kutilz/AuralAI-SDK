import type { Metadata } from "next";
import "./globals.css";
import Nav from "@/components/Nav";
import Footer from "@/components/Footer";

export const metadata: Metadata = {
  title: "AuralAI — Hubungkan & atur perangkatmu",
  description:
    "Setup AuralAI dengan kode suara: hubungkan perangkat, atur layanan AI, dan baca panduan — semuanya dari satu halaman.",
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000"),
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="id">
      <body>
        <a href="#main" className="skip-link">
          Lewati ke konten utama
        </a>
        <Nav />
        <main id="main">{children}</main>
        <Footer />
      </body>
    </html>
  );
}
